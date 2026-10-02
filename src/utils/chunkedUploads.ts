import { getFileExtension } from './mediaValidation.js';

/**
 * Pure rules of the chunked upload protocol (see controllers/chunkedUploadController.ts).
 *
 * The reverse proxy in production cuts every request that runs for more than ~60s, so large files are
 * sent as a sequence of small PUT requests: init -> PUT chunk (offset) ... -> complete.
 */

// 4MB takes ~34s on a 1 Mbps uplink, well under the proxy's 60s request timeout
export const CHUNK_SIZE = 4 * 1024 * 1024;
// Small margin over CHUNK_SIZE for the raw body parser; anything larger is rejected with 413
export const MAX_CHUNK_BODY_BYTES = CHUNK_SIZE + 64 * 1024;
// Sessions without any activity for this long are removed together with their temporary file
export const SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
export const MAX_ORIGINAL_NAME_LENGTH = 255;
const BYTES_PER_MB = 1024 * 1024;
const DEFAULT_MIME_TYPE = 'application/octet-stream';
const CHUNK_ROUTE = /^\/api\/upload\/chunked\/[^/]+\/?$/;
const DIGITS = /^\d+$/;

export type UploadKind = 'video' | 'presentation';
export const UPLOAD_KINDS: readonly UploadKind[] = ['video', 'presentation'];

export interface KindRules {
    maxSizeMb: number;
    isAllowed: (originalName: string, mimetype: string) => boolean;
    rejectMessage: string;
}

export const CHUNKED_UPLOAD_ERRORS = {
    invalidKind: 'Tipo de envio inválido. Use video ou presentation.',
    invalidFilename: 'Nome do arquivo inválido.',
    invalidMimeType: 'Tipo do arquivo inválido.',
    invalidSize: 'Tamanho do arquivo inválido.',
    notFound: 'Envio não encontrado ou expirado. Envie o arquivo novamente.',
    invalidOffset: 'Posição do trecho do arquivo inválida.',
    emptyChunk: 'Trecho do arquivo vazio.',
    offsetMismatch: 'Trecho do arquivo fora de ordem. Continue a partir da posição informada.',
    overflow: 'O trecho ultrapassa o tamanho informado do arquivo.',
    busy: 'Outro trecho deste envio ainda está sendo gravado. Tente novamente em instantes.',
    incomplete: 'O envio ainda não recebeu todos os bytes do arquivo.',
    chunkTooLarge: 'Trecho do arquivo maior que o permitido.'
} as const;

export interface InitRequest {
    kind: UploadKind;
    originalName: string;
    size: number;
    // Validated, lowercased extension of the original name, e.g. '.mp4'
    extension: string;
}

export type InitValidation =
    | { ok: true; value: InitRequest }
    | { ok: false; status: 400 | 413; error: string };

export type ChunkDecision = 'append' | 'duplicate' | 'conflict' | 'overflow' | 'empty';

export interface ChunkProgress {
    size: number;
    received: number;
}

export function sizeLimitMessage(maxSizeMb: number): string {
    return `Arquivo excede o limite de ${maxSizeMb}MB`;
}

export function isUploadKind(value: unknown): value is UploadKind {
    return typeof value === 'string' && (UPLOAD_KINDS as readonly string[]).includes(value);
}

function invalid(error: string): InitValidation {
    return { ok: false, status: 400, error };
}

// Missing or empty MIME types are treated like browsers without a registered type send them
function normalizeMimeType(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return DEFAULT_MIME_TYPE;
    return typeof value === 'string' ? value : null;
}

function normalizeOriginalName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const name = value.trim();
    return name.length > 0 && name.length <= MAX_ORIGINAL_NAME_LENGTH ? name : null;
}

/**
 * Validates POST /upload/chunked/init with the same file type rules as the single-request upload.
 * Like multer's fileSize limit, a file exactly at the limit is rejected.
 */
export function validateInitPayload(body: unknown, rules: Readonly<Record<UploadKind, KindRules>>): InitValidation {
    const payload = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    if (!isUploadKind(payload.kind)) return invalid(CHUNKED_UPLOAD_ERRORS.invalidKind);

    const kindRules = rules[payload.kind];
    const originalName = normalizeOriginalName(payload.filename);
    if (originalName === null) return invalid(CHUNKED_UPLOAD_ERRORS.invalidFilename);

    const mimeType = normalizeMimeType(payload.mimeType);
    if (mimeType === null) return invalid(CHUNKED_UPLOAD_ERRORS.invalidMimeType);
    if (!kindRules.isAllowed(originalName, mimeType)) return invalid(kindRules.rejectMessage);

    const size = payload.size;
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) {
        return invalid(CHUNKED_UPLOAD_ERRORS.invalidSize);
    }
    if (size >= kindRules.maxSizeMb * BYTES_PER_MB) {
        return { ok: false, status: 413, error: sizeLimitMessage(kindRules.maxSizeMb) };
    }

    return { ok: true, value: { kind: payload.kind, originalName, size, extension: getFileExtension(originalName) } };
}

/** Offset query parameter as a non-negative integer, or null when missing/malformed. */
export function parseOffset(raw: unknown): number | null {
    if (typeof raw !== 'string' || !DIGITS.test(raw)) return null;
    const offset = Number(raw);
    return Number.isSafeInteger(offset) ? offset : null;
}

/**
 * What to do with a chunk of `length` bytes sent for position `offset`:
 * - duplicate: a retry of bytes that are already stored (answer 200 without writing)
 * - conflict: not the next expected position (answer 409 with the received count so the client resyncs)
 * - overflow: more bytes than the size announced at init
 * - empty: nothing to write
 */
export function decideChunk({ size, received }: ChunkProgress, offset: number, length: number): ChunkDecision {
    if (length === 0) return 'empty';
    if (offset < received && offset + length <= received) return 'duplicate';
    if (offset !== received) return 'conflict';
    if (received + length > size) return 'overflow';
    return 'append';
}

/** Ids of the sessions idle for longer than idleMs; sessions with a chunk being written are kept. */
export function selectExpiredSessions(
    sessions: Iterable<readonly [string, { updatedAt: number }]>,
    now: number,
    busyIds: ReadonlySet<string> = new Set(),
    idleMs: number = SESSION_IDLE_TIMEOUT_MS
): string[] {
    const expired: string[] = [];
    for (const [id, session] of sessions) {
        if (!busyIds.has(id) && now - session.updatedAt > idleMs) expired.push(id);
    }
    return expired;
}

/** Final stored name, built like the single-request upload: <fieldname>-<unique><ext>. */
export function buildFinalName(kind: UploadKind, uniqueSuffix: string, extension: string): string {
    return `${kind}-${uniqueSuffix}${extension}`;
}

export interface UploadResult {
    message: string;
    filename: string;
    originalName: string;
    size: number;
    videoUrl?: string;
    presentationUrl?: string;
}

/** Same JSON the single-request POST /upload/video and /upload/presentation endpoints answer with. */
export function buildUploadResult(kind: UploadKind, filename: string, originalName: string, size: number): UploadResult {
    if (kind === 'video') {
        return { message: 'Vídeo enviado com sucesso', filename, originalName, size, videoUrl: `/uploads/videos/${filename}` };
    }
    return {
        message: 'Apresentação enviada com sucesso',
        filename,
        originalName,
        size,
        presentationUrl: `/uploads/presentations/${filename}`
    };
}

/** True for PUT /api/upload/chunked/:uploadId (the chunk requests, which have their own rate limit). */
export function isChunkUploadRequest(method: string, requestPath: string): boolean {
    return method === 'PUT' && CHUNK_ROUTE.test(requestPath);
}
