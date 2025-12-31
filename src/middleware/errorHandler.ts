import { Request, Response, NextFunction } from 'express';

// Error interface for typed errors
interface AppError extends Error {
    statusCode?: number;
    code?: string;
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
