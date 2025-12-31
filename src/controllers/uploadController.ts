import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), 'uploads');
const pdfsDir = path.join(uploadsDir, 'pdfs');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(pdfsDir)) {
    fs.mkdirSync(pdfsDir, { recursive: true });
}
if (!fs.existsSync(pdfsDir)) {
    fs.mkdirSync(pdfsDir, { recursive: true });
}

// Configure multer for PDF uploads
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, pdfsDir);
    },
    filename: (_req, file, cb) => {
        // Generate unique filename with timestamp
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, `book-${uniqueSuffix}${ext}`);
    }
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // Accept only PDF files
    if (file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Apenas arquivos PDF são permitidos'));
    }
};

export const uploadPdf = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB max
    }
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
