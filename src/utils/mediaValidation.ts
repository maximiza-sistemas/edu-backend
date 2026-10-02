import path from 'path';
import type { ContentType } from '../types/index.js';

export const CONTENT_TYPES: readonly ContentType[] = ['pdf', 'video', 'pptx'];

// Match books.media_url VARCHAR(1024) and books.pdf_url VARCHAR(512)
export const MAX_MEDIA_URL_LENGTH = 1024;
export const MAX_PDF_URL_LENGTH = 512;

export const VIDEO_EXTENSIONS: readonly string[] = ['.mp4', '.webm', '.ogv', '.m4v'];
export const VIDEO_MIME_TYPES: readonly string[] = ['video/mp4', 'video/webm', 'video/ogg', 'video/x-m4v', 'application/octet-stream'];

export const PRESENTATION_EXTENSIONS: readonly string[] = ['.pptx', '.ppt'];
// Browsers without Office installed send application/octet-stream for PowerPoint files.
// A multipart part without a Content-Type header reaches us as text/plain (busboy default) and is rejected.
export const PRESENTATION_MIME_TYPES: readonly string[] = [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'application/octet-stream'
];

// Accepts exactly the links parseExternalVideoUrl in the frontend (src/utils/media.ts) can play
const YOUTUBE_SHORT_HOST = 'youtu.be';
const YOUTUBE_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];
const VIMEO_HOSTS = ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'];
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_ID_PATHS = ['embed', 'shorts', 'live', 'v'];
// A numeric segment right after one of these is a showcase/album/channel/group/event id, not a video id
const VIMEO_CONTAINER_SEGMENTS = ['showcase', 'album', 'channels', 'groups', 'event'];
const NUMERIC_SEGMENT = /^\d+$/;

// Files written by our own upload endpoints; no leading dot and no '..' so a path can never leave its folder
const UPLOADED_VIDEO_PATH = /^\/uploads\/videos\/(?!\.)(?!.*\.\.)[A-Za-z0-9._-]+$/;
const UPLOADED_PRESENTATION_PATH = /^\/uploads\/presentations\/(?!\.)(?!.*\.\.)[A-Za-z0-9._-]+$/;

export const MEDIA_ERRORS = {
    invalidContentType: 'Tipo de material inválido. Use pdf, video ou pptx.',
    invalidPdfUrl: 'URL do PDF inválida.',
    pdfUrlTooLong: `A URL do PDF excede ${MAX_PDF_URL_LENGTH} caracteres.`,
    invalidMediaUrl: 'Endereço da mídia inválido.',
    mediaUrlTooLong: `O endereço da mídia excede ${MAX_MEDIA_URL_LENGTH} caracteres.`,
    invalidVideo: 'Vídeo inválido. Envie um arquivo de vídeo ou informe um link do YouTube ou Vimeo.',
    invalidPresentation: 'Apresentação inválida. Envie um arquivo PowerPoint (.pptx ou .ppt).'
} as const;

export type MediaValidationResult =
    | { ok: true; content_type: ContentType; media_url: string | null; pdf_url: string | null }
    | { ok: false; error: string };

export function isContentType(value: unknown): value is ContentType {
    return typeof value === 'string' && (CONTENT_TYPES as readonly string[]).includes(value);
}

// vimeo.com/123, vimeo.com/123/abcdef, player.vimeo.com/video/123, vimeo.com/channels/staffpicks/123 and
// vimeo.com/showcase/456/video/123 have a video id; bare showcase/album/channel/group/event links do not
function hasVimeoVideoId(segments: string[]): boolean {
    return segments.some((segment, i) => NUMERIC_SEGMENT.test(segment) && !VIMEO_CONTAINER_SEGMENTS.includes(segments[i - 1]));
}

function isYoutubeVideo(url: URL, segments: string[]): boolean {
    if (segments[0] === 'watch') {
        return YOUTUBE_ID.test(url.searchParams.get('v') ?? '');
    }
    return YOUTUBE_ID_PATHS.includes(segments[0]) && YOUTUBE_ID.test(segments[1] ?? '');
}

/** True only for http(s) YouTube/Vimeo links the frontend player can turn into an embed. */
export function isAllowedVideoLink(raw: string): boolean {
    if (raw.length > MAX_MEDIA_URL_LENGTH) return false;

    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return false;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;

    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);

    if (host === YOUTUBE_SHORT_HOST) return YOUTUBE_ID.test(segments[0] ?? '');
    if (YOUTUBE_HOSTS.includes(host)) return isYoutubeVideo(url, segments);
    if (VIMEO_HOSTS.includes(host)) return hasVimeoVideoId(segments);
    return false;
}

export function isUploadedVideoPath(value: string): boolean {
    return UPLOADED_VIDEO_PATH.test(value);
}

export function isUploadedPresentationPath(value: string): boolean {
    return UPLOADED_PRESENTATION_PATH.test(value);
}

/** Lowercased extension of an uploaded file name, e.g. '.mp4'. */
export function getFileExtension(filename: string): string {
    return path.extname(filename).toLowerCase();
}

export function isAllowedVideoUpload(originalName: string, mimetype: string): boolean {
    return VIDEO_EXTENSIONS.includes(getFileExtension(originalName)) && VIDEO_MIME_TYPES.includes(mimetype);
}

export function isAllowedPresentationUpload(originalName: string, mimetype: string): boolean {
    return PRESENTATION_EXTENSIONS.includes(getFileExtension(originalName)) && PRESENTATION_MIME_TYPES.includes(mimetype);
}

function validateMediaUrl(contentType: 'video' | 'pptx', mediaUrl: unknown): MediaValidationResult {
    if (mediaUrl !== undefined && mediaUrl !== null && typeof mediaUrl !== 'string') {
        return { ok: false, error: MEDIA_ERRORS.invalidMediaUrl };
    }

    // Media is optional, like pdf_url is for PDF books
    const value = mediaUrl ? mediaUrl.trim() : '';
    if (!value) {
        return { ok: true, content_type: contentType, media_url: null, pdf_url: null };
    }
    if (value.length > MAX_MEDIA_URL_LENGTH) {
        return { ok: false, error: MEDIA_ERRORS.mediaUrlTooLong };
    }

    if (contentType === 'video' && !isUploadedVideoPath(value) && !isAllowedVideoLink(value)) {
        return { ok: false, error: MEDIA_ERRORS.invalidVideo };
    }
    if (contentType === 'pptx' && !isUploadedPresentationPath(value)) {
        return { ok: false, error: MEDIA_ERRORS.invalidPresentation };
    }

    return { ok: true, content_type: contentType, media_url: value, pdf_url: null };
}

/**
 * Validates the content fields of a material and keeps only the source that matches its type:
 * PDF books use pdf_url, videos and presentations use media_url.
 */
export function normalizeBookMedia(contentType: unknown, mediaUrl: unknown, pdfUrl: unknown): MediaValidationResult {
    if (!isContentType(contentType)) {
        return { ok: false, error: MEDIA_ERRORS.invalidContentType };
    }

    if (contentType === 'pdf') {
        // Legacy rows may hold arbitrary PDF URLs, so only the type is checked here
        if (pdfUrl !== undefined && pdfUrl !== null && typeof pdfUrl !== 'string') {
            return { ok: false, error: MEDIA_ERRORS.invalidPdfUrl };
        }
        if (pdfUrl && pdfUrl.length > MAX_PDF_URL_LENGTH) {
            return { ok: false, error: MEDIA_ERRORS.pdfUrlTooLong };
        }
        return { ok: true, content_type: 'pdf', media_url: null, pdf_url: pdfUrl ? pdfUrl : null };
    }

    return validateMediaUrl(contentType, mediaUrl);
}
