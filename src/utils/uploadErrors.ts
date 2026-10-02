import multer from 'multer';

export const UPLOAD_ERRORS = {
    malformed: 'Envio de arquivo inválido ou incompleto. Tente enviar novamente.',
    saveFailed: 'Não foi possível salvar o arquivo no servidor. Tente novamente.'
} as const;

export interface StatusError extends Error {
    statusCode: number;
}

export function statusError(statusCode: number, message: string): StatusError {
    return Object.assign(new Error(message), { statusCode });
}

function hasStatusCode(err: unknown): boolean {
    return typeof err === 'object' && err !== null && typeof (err as { statusCode?: unknown }).statusCode === 'number';
}

// Node file system errors carry the failing syscall (open, write, rename...) and an absolute server path
function isFileSystemError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && typeof (err as { syscall?: unknown }).syscall === 'string';
}

/**
 * Maps an error raised while receiving an upload to one that is safe to show to the user.
 * Multer errors and errors that already carry a status code are kept; disk errors become a generic 500
 * and everything else (malformed or truncated multipart bodies from busboy, aborted requests) becomes 400.
 */
export function toUploadError(err: unknown): unknown {
    if (err instanceof multer.MulterError || hasStatusCode(err)) {
        return err;
    }
    if (isFileSystemError(err)) {
        return statusError(500, UPLOAD_ERRORS.saveFailed);
    }
    return statusError(400, UPLOAD_ERRORS.malformed);
}
