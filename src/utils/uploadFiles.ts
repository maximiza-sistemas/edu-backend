import path from 'path';
import { isUploadedPresentationPath, isUploadedVideoPath } from './mediaValidation.js';

// Uploads in progress are written as ".<final name>.part". express.static never serves names starting
// with a dot, and media_url validation rejects them, so a partial file can never be reached publicly.
const TEMP_UPLOAD_PREFIX = '.';
const TEMP_UPLOAD_SUFFIX = '.part';

export function toTempUploadName(filename: string): string {
    return `${TEMP_UPLOAD_PREFIX}${filename}${TEMP_UPLOAD_SUFFIX}`;
}

export function isTempUploadName(filename: string): boolean {
    return filename.startsWith(TEMP_UPLOAD_PREFIX) && filename.endsWith(TEMP_UPLOAD_SUFFIX);
}

/**
 * Absolute path of an uploaded video or presentation referenced by media_url, or null when the value is
 * anything else (external link, PDF, image, malformed path). The result is always a direct child of
 * <uploadsDir>/videos or <uploadsDir>/presentations, so callers can safely delete it.
 */
export function resolveManagedMediaFile(mediaUrl: string, uploadsDir: string): string | null {
    let folder: string;
    if (isUploadedVideoPath(mediaUrl)) {
        folder = 'videos';
    } else if (isUploadedPresentationPath(mediaUrl)) {
        folder = 'presentations';
    } else {
        return null;
    }

    const dir = path.resolve(uploadsDir, folder);
    const name = path.posix.basename(mediaUrl);
    const filePath = path.resolve(dir, name);
    if (path.dirname(filePath) !== dir || path.basename(filePath) !== name) {
        return null;
    }
    return filePath;
}
