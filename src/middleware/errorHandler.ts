import { Request, Response, NextFunction } from 'express';
import multer from 'multer';

// Error interface for typed errors
interface AppError extends Error {
    statusCode?: number;
    code?: string;
}

const MULTER_ERROR_MESSAGES: Partial<Record<multer.ErrorCode, string>> = {
    LIMIT_FILE_COUNT: 'Envie apenas um arquivo por vez',
    LIMIT_UNEXPECTED_FILE: 'Campo de arquivo inesperado'
};

// Upload routes store their size limit in res.locals.uploadLimitMb (see uploadController)
function handleMulterError(err: multer.MulterError, res: Response): void {
    if (err.code === 'LIMIT_FILE_SIZE') {
        const limitMb: unknown = res.locals.uploadLimitMb;
        res.status(413).json({
            error: typeof limitMb === 'number'
                ? `Arquivo excede o limite de ${limitMb}MB`
                : 'Arquivo excede o tamanho máximo permitido'
        });
        return;
    }

    res.status(400).json({ error: MULTER_ERROR_MESSAGES[err.code] || 'Envio de arquivo inválido' });
}

// Global error handler
export function errorHandler(
    err: AppError,
    req: Request,
    res: Response,
    _next: NextFunction
): void {
    console.error('Error:', err.message);
    console.error('Stack:', err.stack);

    // File upload errors (size limit, unexpected field)
    if (err instanceof multer.MulterError) {
        handleMulterError(err, res);
        return;
    }

    // PostgreSQL specific errors
    if (err.code) {
        switch (err.code) {
            case '23505': // Unique violation
                res.status(409).json({ error: 'Registro já existe' });
                return;
            case '23503': // Foreign key violation
                res.status(400).json({ error: 'Referência inválida' });
                return;
            case '22P02': // Invalid text representation
                res.status(400).json({ error: 'Formato de dados inválido' });
                return;
            case '22001': // Value too long for the column
                res.status(400).json({ error: 'Um dos campos excede o tamanho máximo permitido' });
                return;
        }
    }

    const statusCode = err.statusCode || 500;
    const message = err.message || 'Erro interno do servidor';

    res.status(statusCode).json({
        error: message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
}

// 404 handler
export function notFoundHandler(req: Request, res: Response): void {
    res.status(404).json({ error: `Rota ${req.method} ${req.path} não encontrada` });
}

// Async handler wrapper to catch async errors
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
