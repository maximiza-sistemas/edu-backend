import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import {
    createUniqueSuffix,
    getMediaUploadDir,
    MAX_PRESENTATION_SIZE_MB,
    MAX_VIDEO_SIZE_MB,
    PRESENTATION_REJECT_MESSAGE,
    removeFile,
    removeStaleMediaTempUploads,
    VIDEO_REJECT_MESSAGE
} from './uploadController.js';
import { isAllowedPresentationUpload, isAllowedVideoUpload } from '../utils/mediaValidation.js';
import { toTempUploadName } from '../utils/uploadFiles.js';
import { statusError, UPLOAD_ERRORS } from '../utils/uploadErrors.js';
import {
    buildFinalName,
    buildUploadResult,
    CHUNK_SIZE,
    CHUNKED_UPLOAD_ERRORS,
    decideChunk,
    KindRules,
    MAX_CHUNK_BODY_BYTES,
    parseOffset,
    selectExpiredSessions,
    UploadKind,
    UploadResult,
    validateInitPayload
} from '../utils/chunkedUploads.js';

/**
 * Chunked uploads of videos and presentations (admin only).
 *
 *   POST   /upload/chunked/init                 { kind, filename, size, mimeType? } -> 201 { uploadId, chunkSize }
 *   PUT    /upload/chunked/:uploadId?offset=n   raw bytes                           -> 200 { received }
 *   POST   /upload/chunked/:uploadId/complete                                        -> same JSON as POST /upload/video|presentation
 *   DELETE /upload/chunked/:uploadId                                                 -> 204
 *
 * Every request stays small, so none of them hits the reverse proxy's request timeout. Bytes are written
 * to the hidden ".<final name>.part" file (never served) and renamed to the public name on complete.
 *
 * Sessions live in memory: this assumes a SINGLE backend instance. A restart loses every session (clients
 * then get 404 and ask the user to send the file again); the orphaned .part files are removed by the
 * stale temp sweep. Idle sessions expire after SESSION_IDLE_TIMEOUT_MS.
 */

interface ChunkSession {
    readonly userId: string;
    readonly kind: UploadKind;
    readonly finalName: string;
    readonly tempPath: string;
    readonly size: number;
    readonly received: number;
    readonly updatedAt: number;
    readonly originalName: string;
}

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
// A repeated complete (its first response was lost) is answered with the same result for this long
const COMPLETED_RESULT_TTL_MS = 10 * 60 * 1000;
const CHUNK_RATE_WINDOW_MS = 15 * 60 * 1000;
// ~6GB per admin every 15 minutes; a 500MB video needs ~125 chunk requests
const CHUNK_RATE_MAX = 1500;

const KIND_RULES: Readonly<Record<UploadKind, KindRules>> = {
    video: { maxSizeMb: MAX_VIDEO_SIZE_MB, isAllowed: isAllowedVideoUpload, rejectMessage: VIDEO_REJECT_MESSAGE },
    presentation: { maxSizeMb: MAX_PRESENTATION_SIZE_MB, isAllowed: isAllowedPresentationUpload, rejectMessage: PRESENTATION_REJECT_MESSAGE }
};

const sessions = new Map<string, ChunkSession>();
const completedUploads = new Map<string, { userId: string; result: UploadResult; completedAt: number }>();
// Sessions with a chunk being written right now; a second chunk for the same session is rejected with 409
const busySessions = new Set<string>();

// A session belonging to another user is reported exactly like an unknown one
function findOwnSession(req: Request): ChunkSession | undefined {
    const session = sessions.get(req.params.uploadId);
    return session && session.userId === req.user?.userId ? session : undefined;
}

function sendNotFound(res: Response): void {
    res.status(404).json({ error: CHUNKED_UPLOAD_ERRORS.notFound });
}

async function writeChunkAt(filePath: string, chunk: Buffer, position: number): Promise<void> {
    const handle = await fs.promises.open(filePath, 'r+');
    try {
        let written = 0;
        while (written < chunk.length) {
            const { bytesWritten } = await handle.write(chunk, written, chunk.length - written, position + written);
            written += bytesWritten;
        }
    } finally {
        await handle.close();
    }
}

/**
 * Chunk requests skip the global limiter (see index.ts) and are limited here per admin instead: behind the
 * reverse proxy every client shares the proxy's IP, so an IP key would let one big upload eat the whole
 * platform's budget.
 */
export const chunkUploadLimiter = rateLimit({
    windowMs: CHUNK_RATE_WINDOW_MS,
    max: CHUNK_RATE_MAX,
    keyGenerator: (req) => req.user?.userId ?? req.ip ?? 'anonymous',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitos trechos enviados em pouco tempo. Aguarde alguns minutos e tente novamente.' }
});

/** Answers 404 before the chunk body is read when the session is unknown or belongs to someone else. */
export function requireChunkSession(req: Request, res: Response, next: NextFunction): void {
    if (findOwnSession(req)) {
        next();
        return;
    }
    sendNotFound(res);
}

const parseChunkBody = express.raw({ type: () => true, limit: MAX_CHUNK_BODY_BYTES });

/** Reads the raw chunk (any Content-Type, mounted only on the chunk route) with pt-BR errors. */
export const readChunkBody: RequestHandler = (req, res, next) => {
    parseChunkBody(req, res, (err?: unknown) => {
        if (!err) {
            next();
            return;
        }
        const tooLarge = (err as { type?: unknown }).type === 'entity.too.large';
        res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? CHUNKED_UPLOAD_ERRORS.chunkTooLarge : UPLOAD_ERRORS.malformed });
    });
};

export async function initChunkedUpload(req: Request, res: Response): Promise<void> {
    const validation = validateInitPayload(req.body, KIND_RULES);
    if (!validation.ok) {
        res.status(validation.status).json({ error: validation.error });
        return;
    }

    const { kind, originalName, size, extension } = validation.value;
    const finalName = buildFinalName(kind, createUniqueSuffix(), extension);
    const tempPath = path.join(getMediaUploadDir(kind), toTempUploadName(finalName));
    try {
        await fs.promises.writeFile(tempPath, '', { flag: 'wx' });
    } catch (error) {
        console.error('Erro ao iniciar o upload em partes:', error);
        throw statusError(500, UPLOAD_ERRORS.saveFailed);
    }

    const uploadId = randomUUID();
    sessions.set(uploadId, {
        userId: req.user!.userId,
        kind,
        finalName,
        tempPath,
        size,
        received: 0,
        updatedAt: Date.now(),
        originalName
    });
    res.status(201).json({ uploadId, chunkSize: CHUNK_SIZE });
}

async function appendChunk(uploadId: string, session: ChunkSession, chunk: Buffer, res: Response): Promise<void> {
    busySessions.add(uploadId);
    try {
        await writeChunkAt(session.tempPath, chunk, session.received);
    } catch (error) {
        console.error('Erro ao gravar trecho do upload:', error);
        // Cancelled while writing: cancel left the file to this handler
        if (!sessions.has(uploadId)) await removeFile(session.tempPath);
        res.status(500).json({ error: UPLOAD_ERRORS.saveFailed });
        return;
    } finally {
        busySessions.delete(uploadId);
    }

    // Cancelled or expired while the chunk was being written: the file is no longer wanted
    const current = sessions.get(uploadId);
    if (!current) {
        await removeFile(session.tempPath);
        sendNotFound(res);
        return;
    }
    const received = session.received + chunk.length;
    sessions.set(uploadId, { ...current, received, updatedAt: Date.now() });
    res.json({ received });
}

export async function receiveChunk(req: Request, res: Response): Promise<void> {
    const uploadId = req.params.uploadId;
    const session = findOwnSession(req);
    if (!session) {
        sendNotFound(res);
        return;
    }
    const offset = parseOffset(req.query.offset);
    if (offset === null) {
        res.status(400).json({ error: CHUNKED_UPLOAD_ERRORS.invalidOffset });
        return;
    }

    // Without a body (or with a JSON body parsed earlier) there is no Buffer
    const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    switch (decideChunk(session, offset, chunk.length)) {
        case 'duplicate':
            res.json({ received: session.received });
            return;
        case 'conflict':
            res.status(409).json({ error: CHUNKED_UPLOAD_ERRORS.offsetMismatch, received: session.received });
            return;
        case 'overflow':
            res.status(400).json({ error: CHUNKED_UPLOAD_ERRORS.overflow });
            return;
        case 'empty':
            res.status(400).json({ error: CHUNKED_UPLOAD_ERRORS.emptyChunk });
            return;
    }
    if (busySessions.has(uploadId)) {
        res.status(409).json({ error: CHUNKED_UPLOAD_ERRORS.busy, received: session.received });
        return;
    }
    await appendChunk(uploadId, session, chunk, res);
}

// Idempotent complete: a client that lost the first response and retries gets the same result
function findCompletedResult(req: Request): UploadResult | undefined {
    const completed = completedUploads.get(req.params.uploadId);
    return completed && completed.userId === req.user?.userId ? completed.result : undefined;
}

export async function completeChunkedUpload(req: Request, res: Response): Promise<void> {
    const uploadId = req.params.uploadId;
    const session = findOwnSession(req);
    if (!session) {
        const previous = findCompletedResult(req);
        if (previous) {
            res.json(previous);
        } else {
            sendNotFound(res);
        }
        return;
    }
    if (busySessions.has(uploadId)) {
        res.status(409).json({ error: CHUNKED_UPLOAD_ERRORS.busy, received: session.received });
        return;
    }
    if (session.received !== session.size) {
        res.status(409).json({ error: CHUNKED_UPLOAD_ERRORS.incomplete, received: session.received });
        return;
    }

    sessions.delete(uploadId);
    try {
        await fs.promises.rename(session.tempPath, path.join(path.dirname(session.tempPath), session.finalName));
    } catch (error) {
        console.error('Erro ao finalizar o upload em partes:', error);
        await removeFile(session.tempPath);
        throw statusError(500, UPLOAD_ERRORS.saveFailed);
    }
    const result = buildUploadResult(session.kind, session.finalName, session.originalName, session.size);
    completedUploads.set(uploadId, { userId: session.userId, result, completedAt: Date.now() });
    res.json(result);
}

/** Idempotent: unknown sessions (or sessions of another user) are answered with 204 as well. */
export async function cancelChunkedUpload(req: Request, res: Response): Promise<void> {
    const uploadId = req.params.uploadId;
    const session = findOwnSession(req);
    if (session) {
        sessions.delete(uploadId);
        // A chunk still being written removes the file itself once it notices the session is gone
        if (!busySessions.has(uploadId)) await removeFile(session.tempPath);
    }
    res.status(204).end();
}

async function expireIdleSessions(now: number): Promise<void> {
    for (const [uploadId, { completedAt }] of completedUploads) {
        if (now - completedAt > COMPLETED_RESULT_TTL_MS) completedUploads.delete(uploadId);
    }
    for (const uploadId of selectExpiredSessions(sessions, now, busySessions)) {
        const session = sessions.get(uploadId);
        sessions.delete(uploadId);
        if (session) await removeFile(session.tempPath);
    }
}

async function sweep(): Promise<void> {
    try {
        await expireIdleSessions(Date.now());
        await removeStaleMediaTempUploads();
    } catch (error) {
        console.error('Erro ao limpar uploads em partes expirados:', error);
    }
}

setInterval(() => void sweep(), SWEEP_INTERVAL_MS).unref();
