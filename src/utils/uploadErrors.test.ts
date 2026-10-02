import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import multer from 'multer';
import { statusError, toUploadError, UPLOAD_ERRORS } from './uploadErrors.js';

function fsError(code: string, syscall: string): Error {
    return Object.assign(new Error(`${code}: failed, ${syscall} '/data/uploads/videos/video-1.mp4'`), { code, syscall });
}

describe('toUploadError', () => {
    it('keeps multer errors for the size-limit and field handling', () => {
        const err = new multer.MulterError('LIMIT_FILE_SIZE', 'video');
        assert.equal(toUploadError(err), err);
    });

    it('keeps errors that already carry a status code', () => {
        const err = statusError(400, 'Formato de vídeo não suportado.');
        assert.equal(toUploadError(err), err);
    });

    it('turns malformed or truncated multipart bodies into a 400 without the parser message', () => {
        for (const message of ['Unexpected end of form', 'Multipart: Boundary not found', 'Malformed part header']) {
            const mapped = toUploadError(new Error(message)) as { statusCode: number; message: string };
            assert.equal(mapped.statusCode, 400, message);
            assert.equal(mapped.message, UPLOAD_ERRORS.malformed, message);
        }
    });

    it('treats an aborted request as a client error', () => {
        const aborted = Object.assign(new Error('aborted'), { code: 'ECONNRESET' });
        assert.equal((toUploadError(aborted) as { statusCode: number }).statusCode, 400);
    });

    it('hides server paths of disk errors behind a generic 500', () => {
        for (const err of [fsError('ENOSPC', 'write'), fsError('EACCES', 'open'), fsError('ENOENT', 'open')]) {
            const mapped = toUploadError(err) as { statusCode: number; message: string };
            assert.equal(mapped.statusCode, 500);
            assert.equal(mapped.message, UPLOAD_ERRORS.saveFailed);
            assert.doesNotMatch(mapped.message, /\/data\//);
        }
    });

    it('handles values that are not Error objects', () => {
        assert.equal((toUploadError('boom') as { statusCode: number }).statusCode, 400);
        assert.equal((toUploadError(null) as { statusCode: number }).statusCode, 400);
    });
});
