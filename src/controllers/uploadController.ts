import { Request, Response, RequestHandler } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { query } from '../config/database.js';
import { getFileExtension, isAllowedPresentationUpload, isAllowedVideoUpload } from '../utils/mediaValidation.js';
import { isTempUploadName, resolveManagedMediaFile, toTempUploadName } from '../utils/uploadFiles.js';
import { statusError, toUploadError, UPLOAD_ERRORS } from '../utils/uploadErrors.js';

// Upload size limits (the frontend checks the same values before sending)
export const MAX_FILE_SIZE_MB = 50;
export const MAX_VIDEO_SIZE_MB = 500;
// The free Office Online viewer only renders PowerPoint files up to 10MB
export const MAX_PRESENTATION_SIZE_MB = 10;
export const VIDEO_REJECT_MESSAGE = 'Formato de vídeo não suportado. Envie um arquivo MP4, WebM, OGV ou M4V.';
export const PRESENTATION_REJECT_MESSAGE = 'Formato de apresentação não suportado. Envie um arquivo PowerPoint (.pptx ou .ppt).';
const BYTES_PER_MB = 1024 * 1024;
// Temporary files older than this are leftovers of a crash (uploads time out after 30 minutes)
const STALE_TEMP_UPLOAD_MS = 2 * 60 * 60 * 1000;

// Create uploads directory - use /data for production persistence (EasyPanel/Docker)
// In production, /data is typically mounted as a persistent volume
const isProduction = process.env.NODE_ENV === 'production';
const baseDir = isProduction ? '/data' : process.cwd();
const uploadsDir = path.join(baseDir, 'uploads');
const pdfsDir = path.join(uploadsDir, 'pdfs');
const imagesDir = path.join(uploadsDir, 'images');
const videosDir = path.join(uploadsDir, 'videos');
const presentationsDir = path.join(uploadsDir, 'presentations');

console.log(`📁 Uploads directory: ${uploadsDir} (production: ${isProduction})`);

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(pdfsDir)) {
    fs.mkdirSync(pdfsDir, { recursive: true });
}
if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
}
if (!fs.existsSync(videosDir)) {
    fs.mkdirSync(videosDir, { recursive: true });
}
if (!fs.existsSync(presentationsDir)) {
    fs.mkdirSync(presentationsDir, { recursive: true });
}

// Rejected file types are answered with 400 and this message by the error handler
function invalidFileError(message: string): Error {
    return statusError(400, message);
}

export function createUniqueSuffix(): string {
    return Date.now() + '-' + Math.round(Math.random() * 1E9);
}

// Deleting a file that is already gone is not an error; other failures are only logged
export async function removeFile(filePath: string): Promise<void> {
    try {
        await fs.promises.unlink(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error(`Erro ao remover o arquivo ${filePath}:`, error);
        }
    }
}

export interface SingleFileUpload {
    single(fieldName: string): RequestHandler;
}

// Records the route's size limit so the error handler can report it when multer rejects a large file,
// and replaces parse/disk errors (which may contain server paths) with messages that are safe to show
function withSizeLimit(upload: multer.Multer, maxSizeMb: number, onRequest?: (req: Request, res: Response) => void): SingleFileUpload {
    return {
        single(fieldName: string): RequestHandler {
            const middleware = upload.single(fieldName);
            return (req, res, next) => {
                res.locals.uploadLimitMb = maxSizeMb;
                onRequest?.(req, res);
                middleware(req, res, (err?: unknown) => {
                    if (!err) {
                        next();
                        return;
                    }
                    const uploadError = toUploadError(err);
                    if (uploadError !== err) {
                        console.error('Upload failed:', err);
                    }
                    next(uploadError);
                });
            };
        }
    };
}

// Configure multer for PDF uploads
const storage = multer.diskStorage({
    destination: (_req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, pdfsDir);
        } else if (file.mimetype.startsWith('image/')) {
            cb(null, imagesDir);
        } else {
            cb(new Error('Tipo de arquivo não suportado'), '');
        }
    },
    filename: (_req, file, cb) => {
        // Generate unique filename with timestamp
        const uniqueSuffix = createUniqueSuffix();
        const ext = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    }
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // Accept PDF and Image files
    if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(invalidFileError('Apenas arquivos PDF e imagens são permitidos'));
    }
};

export const uploadConfig = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE_MB * BYTES_PER_MB
    }
});

// Export specific upload middlewares
export const uploadPdf = withSizeLimit(uploadConfig, MAX_FILE_SIZE_MB);
export const uploadImage = withSizeLimit(uploadConfig, MAX_FILE_SIZE_MB);

interface MediaUploadOptions {
    dir: string;
    maxSizeMb: number;
    isAllowed: (originalName: string, mimetype: string) => boolean;
    rejectMessage: string;
}

interface PendingWrite {
    tempPath: string;
    stream: fs.WriteStream;
}

// Temporary files of each media upload request; whatever the handler did not promote is deleted when
// the response closes (success, error, client abort or request timeout)
const pendingWrites = new WeakMap<Request, readonly PendingWrite[]>();

function discardPendingWrites(req: Request): void {
    for (const { tempPath, stream } of pendingWrites.get(req) ?? []) {
        if (stream.closed) {
            void removeFile(tempPath);
        } else {
            // An aborted upload never ends its write stream; close it first so the file can be removed
            stream.once('close', () => void removeFile(tempPath));
            stream.destroy();
        }
    }
    pendingWrites.delete(req);
}

// Like multer.diskStorage, but writes to a hidden temporary name inside the target folder
function createTempDiskStorage(dir: string): multer.StorageEngine {
    return {
        _handleFile(req, file, cb) {
            // The stored name only keeps the validated, lowercased extension of the original file name
            const filename = `${file.fieldname}-${createUniqueSuffix()}${getFileExtension(file.originalname)}`;
            const tempPath = path.join(dir, toTempUploadName(filename));
            const stream = fs.createWriteStream(tempPath);
            pendingWrites.set(req, [...(pendingWrites.get(req) ?? []), { tempPath, stream }]);
            stream.on('error', cb);
            stream.on('finish', () => cb(null, { destination: dir, filename, path: tempPath, size: stream.bytesWritten }));
            file.stream.pipe(stream);
        },
        _removeFile(_req, file, cb) {
            removeFile(file.path).then(() => cb(null), cb);
        }
    };
}

// Gives a completely received upload its public name; until then it is never served
async function promoteUpload(req: Request, file: Express.Multer.File): Promise<string> {
    try {
        await fs.promises.rename(file.path, path.join(file.destination, file.filename));
    } catch (error) {
        console.error('Erro ao finalizar o upload:', error);
        throw statusError(500, UPLOAD_ERRORS.saveFailed);
    }
    pendingWrites.set(req, (pendingWrites.get(req) ?? []).filter(write => write.tempPath !== file.path));
    return file.filename;
}

// Temporary files can only outlive their request if the process stopped mid-upload
async function removeStaleTempUploads(dir: string): Promise<void> {
    try {
        const now = Date.now();
        for (const name of (await fs.promises.readdir(dir)).filter(isTempUploadName)) {
            const filePath = path.join(dir, name);
            const { mtimeMs } = await fs.promises.stat(filePath);
            if (now - mtimeMs > STALE_TEMP_UPLOAD_MS) {
                await removeFile(filePath);
            }
        }
    } catch (error) {
        console.error(`Erro ao limpar uploads temporários em ${dir}:`, error);
    }
}

/** Removes temporary files left behind by a stopped process (runs at startup and periodically). */
export async function removeStaleMediaTempUploads(): Promise<void> {
    await removeStaleTempUploads(videosDir);
    await removeStaleTempUploads(presentationsDir);
}

void removeStaleMediaTempUploads();

/** Folder that stores uploaded videos or presentations. */
export function getMediaUploadDir(kind: 'video' | 'presentation'): string {
    return kind === 'video' ? videosDir : presentationsDir;
}

// Each media type gets its own multer instance, so file types and size limits never leak between routes
function createMediaUpload({ dir, maxSizeMb, isAllowed, rejectMessage }: MediaUploadOptions): SingleFileUpload {
    const upload = multer({
        storage: createTempDiskStorage(dir),
        fileFilter: (_req, file, cb) => {
            if (isAllowed(file.originalname, file.mimetype)) {
                cb(null, true);
            } else {
                cb(invalidFileError(rejectMessage));
            }
        },
        limits: {
            fileSize: maxSizeMb * BYTES_PER_MB
        }
    });
    return withSizeLimit(upload, maxSizeMb, (req, res) => {
        res.once('close', () => discardPendingWrites(req));
    });
}

export const uploadVideo = createMediaUpload({
    dir: videosDir,
    maxSizeMb: MAX_VIDEO_SIZE_MB,
    isAllowed: isAllowedVideoUpload,
    rejectMessage: VIDEO_REJECT_MESSAGE
});

export const uploadPresentation = createMediaUpload({
    dir: presentationsDir,
    maxSizeMb: MAX_PRESENTATION_SIZE_MB,
    isAllowed: isAllowedPresentationUpload,
    rejectMessage: PRESENTATION_REJECT_MESSAGE
});

// Upload PDF endpoint handler
export async function handlePdfUpload(req: Request, res: Response): Promise<void> {
    if (!req.file) {
        res.status(400).json({ error: 'Nenhum arquivo enviado' });
        return;
    }

    const pdfUrl = `/uploads/pdfs/${req.file.filename}`;

    res.json({
        message: 'PDF enviado com sucesso',
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        pdfUrl
    });
}

// Upload Image endpoint handler
export async function handleImageUpload(req: Request, res: Response): Promise<void> {
    if (!req.file) {
        res.status(400).json({ error: 'Nenhum arquivo enviado' });
        return;
    }

    const imageUrl = `/uploads/images/${req.file.filename}`;

    res.json({
        message: 'Imagem enviada com sucesso',
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        imageUrl
    });
}

// Upload Video endpoint handler
export async function handleVideoUpload(req: Request, res: Response): Promise<void> {
    if (!req.file) {
        res.status(400).json({ error: 'Nenhum arquivo enviado' });
        return;
    }

    const filename = await promoteUpload(req, req.file);
    const videoUrl = `/uploads/videos/${filename}`;

    res.json({
        message: 'Vídeo enviado com sucesso',
        filename,
        originalName: req.file.originalname,
        size: req.file.size,
        videoUrl
    });
}

// Upload Presentation endpoint handler
export async function handlePresentationUpload(req: Request, res: Response): Promise<void> {
    if (!req.file) {
        res.status(400).json({ error: 'Nenhum arquivo enviado' });
        return;
    }

    const filename = await promoteUpload(req, req.file);
    const presentationUrl = `/uploads/presentations/${filename}`;

    res.json({
        message: 'Apresentação enviada com sucesso',
        filename,
        originalName: req.file.originalname,
        size: req.file.size,
        presentationUrl
    });
}

// Delete PDF file
export async function deletePdfFile(filename: string): Promise<boolean> {
    const filePath = path.join(pdfsDir, filename);
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error deleting PDF:', error);
        return false;
    }
}

/**
 * Deletes uploaded videos/presentations that no material references any more. Call it only after the
 * change that dropped the reference has committed. Anything outside uploads/videos and
 * uploads/presentations (links, PDFs, images) is left alone. Never throws: failures are logged.
 */
export async function removeUnreferencedMedia(mediaUrls: readonly (string | null | undefined)[]): Promise<void> {
    const candidates = new Set(mediaUrls.filter((url): url is string => typeof url === 'string' && url.length > 0));
    for (const mediaUrl of candidates) {
        const filePath = resolveManagedMediaFile(mediaUrl, uploadsDir);
        if (!filePath) continue;
        try {
            const stillUsed = await query('SELECT 1 FROM books WHERE media_url = $1 LIMIT 1', [mediaUrl]);
            if (stillUsed.rows.length === 0) {
                await removeFile(filePath);
            }
        } catch (error) {
            console.error(`Erro ao remover a mídia não utilizada ${mediaUrl}:`, error);
        }
    }
}

// Get uploads directory path for static serving
export function getUploadsDir(): string {
    return uploadsDir;
}
