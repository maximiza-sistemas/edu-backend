import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Create uploads directory - use /data for production persistence (EasyPanel/Docker)
// In production, /data is typically mounted as a persistent volume
const isProduction = process.env.NODE_ENV === 'production';
const baseDir = isProduction ? '/data' : process.cwd();
const uploadsDir = path.join(baseDir, 'uploads');
const pdfsDir = path.join(uploadsDir, 'pdfs');
const imagesDir = path.join(uploadsDir, 'images');

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
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    }
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // Accept PDF and Image files
    if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Apenas arquivos PDF e imagens são permitidos'));
    }
};

export const uploadConfig = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB max
    }
});

// Export specific upload middlewares
export const uploadPdf = uploadConfig;
export const uploadImage = uploadConfig;

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

// Get uploads directory path for static serving
export function getUploadsDir(): string {
    return uploadsDir;
}
