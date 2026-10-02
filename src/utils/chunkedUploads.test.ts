import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildFinalName,
    buildUploadResult,
    CHUNK_SIZE,
    CHUNKED_UPLOAD_ERRORS,
    decideChunk,
    isChunkUploadRequest,
    KindRules,
    MAX_CHUNK_BODY_BYTES,
    MAX_ORIGINAL_NAME_LENGTH,
    parseOffset,
    selectExpiredSessions,
    SESSION_IDLE_TIMEOUT_MS,
    UploadKind,
    validateInitPayload
} from './chunkedUploads.js';
import { isAllowedPresentationUpload, isAllowedVideoUpload } from './mediaValidation.js';

const MB = 1024 * 1024;
const RULES: Record<UploadKind, KindRules> = {
    video: { maxSizeMb: 500, isAllowed: isAllowedVideoUpload, rejectMessage: 'video rejected' },
    presentation: { maxSizeMb: 10, isAllowed: isAllowedPresentationUpload, rejectMessage: 'presentation rejected' }
};
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const video = (over: Record<string, unknown> = {}) => ({ kind: 'video', filename: 'Aula 1.MP4', size: 10 * MB, mimeType: 'video/mp4', ...over });

describe('chunk size', () => {
    it('is 4MB and the body limit leaves only a small margin', () => {
        assert.equal(CHUNK_SIZE, 4 * MB);
        assert.ok(MAX_CHUNK_BODY_BYTES > CHUNK_SIZE && MAX_CHUNK_BODY_BYTES <= CHUNK_SIZE + MB);
    });
});

describe('validateInitPayload', () => {
    it('accepts a valid video and keeps the lowercased extension', () => {
        assert.deepEqual(validateInitPayload(video(), RULES), {
            ok: true,
            value: { kind: 'video', originalName: 'Aula 1.MP4', size: 10 * MB, extension: '.mp4' }
        });
    });

    it('accepts a presentation with its Office MIME type', () => {
        const result = validateInitPayload({ kind: 'presentation', filename: 'slides.pptx', size: 1234, mimeType: PPTX_MIME }, RULES);
        assert.equal(result.ok, true);
    });

    it('treats a missing or empty mimeType like application/octet-stream', () => {
        assert.equal(validateInitPayload(video({ mimeType: undefined }), RULES).ok, true);
        assert.equal(validateInitPayload(video({ mimeType: '' }), RULES).ok, true);
        assert.equal(validateInitPayload({ kind: 'presentation', filename: 'a.ppt', size: 5 }, RULES).ok, true);
    });

    it('rejects unknown kinds and non-object bodies', () => {
        for (const body of [video({ kind: 'pdf' }), video({ kind: undefined }), null, 'video', []]) {
            assert.deepEqual(validateInitPayload(body, RULES), { ok: false, status: 400, error: CHUNKED_UPLOAD_ERRORS.invalidKind });
        }
    });

    it('rejects missing, blank and overly long file names', () => {
        for (const filename of [undefined, 42, '   ', 'a'.repeat(MAX_ORIGINAL_NAME_LENGTH) + '.mp4']) {
            assert.deepEqual(validateInitPayload(video({ filename }), RULES), { ok: false, status: 400, error: CHUNKED_UPLOAD_ERRORS.invalidFilename });
        }
    });

    it('rejects a non-string mimeType', () => {
        assert.deepEqual(validateInitPayload(video({ mimeType: 5 }), RULES), { ok: false, status: 400, error: CHUNKED_UPLOAD_ERRORS.invalidMimeType });
    });

    it('applies the same extension and MIME rules as the single-request upload', () => {
        const rejected = { ok: false, status: 400, error: 'video rejected' };
        assert.deepEqual(validateInitPayload(video({ filename: 'virus.exe' }), RULES), rejected);
        assert.deepEqual(validateInitPayload(video({ filename: 'clip.mov' }), RULES), rejected);
        assert.deepEqual(validateInitPayload(video({ mimeType: 'text/html' }), RULES), rejected);
        assert.deepEqual(validateInitPayload({ kind: 'presentation', filename: 'a.pptx', size: 5, mimeType: 'text/plain' }, RULES),
            { ok: false, status: 400, error: 'presentation rejected' });
        // A video name is not a presentation
        assert.deepEqual(validateInitPayload({ kind: 'presentation', filename: 'a.mp4', size: 5, mimeType: 'video/mp4' }, RULES),
            { ok: false, status: 400, error: 'presentation rejected' });
    });

    it('rejects sizes that are not positive safe integers', () => {
        for (const size of [0, -1, 1.5, '100', undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 2]) {
            assert.deepEqual(validateInitPayload(video({ size }), RULES), { ok: false, status: 400, error: CHUNKED_UPLOAD_ERRORS.invalidSize });
        }
    });

    it('answers 413 for a file at or over the limit, like multer', () => {
        const tooLarge = { ok: false, status: 413, error: 'Arquivo excede o limite de 500MB' };
        assert.deepEqual(validateInitPayload(video({ size: 500 * MB }), RULES), tooLarge);
        assert.deepEqual(validateInitPayload(video({ size: 501 * MB }), RULES), tooLarge);
        assert.equal(validateInitPayload(video({ size: 500 * MB - 1 }), RULES).ok, true);
        assert.deepEqual(validateInitPayload({ kind: 'presentation', filename: 'a.pptx', size: 10 * MB, mimeType: PPTX_MIME }, RULES),
            { ok: false, status: 413, error: 'Arquivo excede o limite de 10MB' });
    });
});

describe('parseOffset', () => {
    it('accepts non-negative integers', () => {
        assert.equal(parseOffset('0'), 0);
        assert.equal(parseOffset('4194304'), 4194304);
    });

    it('rejects anything else', () => {
        for (const raw of [undefined, '', '-1', '1.5', '1e3', ' 1', 'abc', ['1'], '99999999999999999999']) {
            assert.equal(parseOffset(raw), null, String(raw));
        }
    });
});

describe('decideChunk', () => {
    const state = { size: 10, received: 4 };

    it('appends the chunk that starts at the received position', () => {
        assert.equal(decideChunk(state, 4, 4), 'append');
        assert.equal(decideChunk(state, 4, 6), 'append');
        assert.equal(decideChunk({ size: 10, received: 0 }, 0, 10), 'append');
    });

    it('treats a retry of bytes already stored as a duplicate', () => {
        assert.equal(decideChunk(state, 0, 4), 'duplicate');
        assert.equal(decideChunk(state, 2, 2), 'duplicate');
        assert.equal(decideChunk({ size: 10, received: 10 }, 6, 4), 'duplicate');
    });

    it('reports a conflict for gaps and partially overlapping chunks', () => {
        assert.equal(decideChunk(state, 5, 1), 'conflict');
        assert.equal(decideChunk(state, 8, 2), 'conflict');
        assert.equal(decideChunk(state, 2, 4), 'conflict');
    });

    it('rejects chunks beyond the announced size and empty chunks', () => {
        assert.equal(decideChunk(state, 4, 7), 'overflow');
        assert.equal(decideChunk({ size: 10, received: 10 }, 10, 1), 'overflow');
        assert.equal(decideChunk(state, 4, 0), 'empty');
    });
});

describe('selectExpiredSessions', () => {
    const now = 10 * SESSION_IDLE_TIMEOUT_MS;
    const sessions = new Map([
        ['fresh', { updatedAt: now - 1000 }],
        ['edge', { updatedAt: now - SESSION_IDLE_TIMEOUT_MS }],
        ['idle', { updatedAt: now - SESSION_IDLE_TIMEOUT_MS - 1 }],
        ['busy', { updatedAt: 0 }]
    ]);

    it('selects only sessions idle for longer than the timeout and never busy ones', () => {
        assert.deepEqual(selectExpiredSessions(sessions, now, new Set(['busy'])), ['idle']);
    });

    it('accepts a custom idle time', () => {
        assert.deepEqual(selectExpiredSessions(sessions, now, new Set(), 500).sort(), ['busy', 'edge', 'fresh', 'idle']);
    });
});

describe('result and routing helpers', () => {
    it('builds the stored name like the single-request upload', () => {
        assert.equal(buildFinalName('video', '1-2', '.mp4'), 'video-1-2.mp4');
        assert.equal(buildFinalName('presentation', '1-2', '.pptx'), 'presentation-1-2.pptx');
    });

    it('answers with the same JSON as POST /upload/video and /upload/presentation', () => {
        assert.deepEqual(buildUploadResult('video', 'video-1.mp4', 'a.mp4', 5), {
            message: 'Vídeo enviado com sucesso', filename: 'video-1.mp4', originalName: 'a.mp4', size: 5, videoUrl: '/uploads/videos/video-1.mp4'
        });
        assert.deepEqual(buildUploadResult('presentation', 'presentation-1.pptx', 'a.pptx', 5), {
            message: 'Apresentação enviada com sucesso',
            filename: 'presentation-1.pptx',
            originalName: 'a.pptx',
            size: 5,
            presentationUrl: '/uploads/presentations/presentation-1.pptx'
        });
    });

    it('recognizes only chunk PUT requests', () => {
        assert.equal(isChunkUploadRequest('PUT', '/api/upload/chunked/abc'), true);
        assert.equal(isChunkUploadRequest('PUT', '/api/upload/chunked/abc/'), true);
        assert.equal(isChunkUploadRequest('POST', '/api/upload/chunked/abc'), false);
        assert.equal(isChunkUploadRequest('PUT', '/api/upload/chunked/abc/complete'), false);
        assert.equal(isChunkUploadRequest('PUT', '/api/books/1'), false);
    });
});
