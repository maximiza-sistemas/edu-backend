import fs from 'fs';
import { unzipSync, zipSync } from 'fflate';
import type { Zippable } from 'fflate';

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const CONTENT_TYPES_PART = '[Content_Types].xml';
// Images, audio and video inside ppt/media are already compressed; deflating them again only costs time
const STORED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'mp4', 'm4v', 'mov', 'mp3', 'm4a', 'wma', 'wmv']);

function isZip(data: Uint8Array): boolean {
    return ZIP_SIGNATURE.every((byte, i) => data[i] === byte);
}

function partOrder(name: string): number {
    if (name === CONTENT_TYPES_PART) return 0;
    return name.startsWith('_rels/') ? 1 : 2;
}

/**
 * Rewrites a .pptx package the way PowerPoint saves it: [Content_Types].xml first, then the package
 * relationships, no folder entries, deflated parts. Files re-zipped by other tools (folder entries,
 * other order, no compression) open in desktop PowerPoint but are refused by the Office Online viewer.
 * Part contents are never changed. Returns null when the data is not a readable OOXML package
 * (e.g. a binary .ppt), so the caller keeps the file as it was sent.
 */
export function normalizePresentationPackage(data: Uint8Array): Uint8Array | null {
    if (!isZip(data)) return null;

    let parts: Record<string, Uint8Array>;
    try {
        parts = unzipSync(data);
    } catch {
        return null;
    }
    if (!(CONTENT_TYPES_PART in parts)) return null;

    const names = Object.keys(parts)
        .filter(name => !name.endsWith('/'))
        .sort((a, b) => partOrder(a) - partOrder(b));

    const zippable: Zippable = {};
    for (const name of names) {
        const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
        zippable[name] = [parts[name], { level: STORED_EXTENSIONS.has(extension) ? 0 : 6 }];
    }
    return zipSync(zippable);
}

/**
 * Normalizes an uploaded presentation in place (see normalizePresentationPackage) and returns its size.
 * Only call it on files that are not public yet. Failures keep the original file: the upload still works,
 * it just may not open in the online viewer.
 */
export async function normalizePresentationFile(filePath: string): Promise<number> {
    const original = await fs.promises.readFile(filePath);
    const normalized = normalizePresentationPackage(original);
    if (!normalized) return original.length;
    try {
        await fs.promises.writeFile(filePath, normalized);
        return normalized.length;
    } catch (error) {
        console.error('Erro ao normalizar a apresentação:', error);
        // A partial write would leave a broken file; put the original bytes back
        await fs.promises.writeFile(filePath, original);
        return original.length;
    }
}
