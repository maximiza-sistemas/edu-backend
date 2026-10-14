import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { normalizePresentationFile, normalizePresentationPackage } from './presentationPackage.js';

const PARTS: Record<string, string> = {
    '[Content_Types].xml': '<Types/>',
    '_rels/.rels': '<Relationships/>',
    'ppt/presentation.xml': '<p:presentation/>',
    'ppt/slides/slide1.xml': '<p:sld/>'
};

// Like a .pptx re-zipped by another tool: folder entries, [Content_Types].xml last, no compression
function messyPackage(): Uint8Array {
    return zipSync({
        '_rels/': new Uint8Array(0),
        'ppt/': new Uint8Array(0),
        'ppt/slides/': new Uint8Array(0),
        'ppt/media/': new Uint8Array(0),
        'ppt/slides/slide1.xml': strToU8(PARTS['ppt/slides/slide1.xml']),
        'ppt/presentation.xml': strToU8(PARTS['ppt/presentation.xml']),
        '_rels/.rels': strToU8(PARTS['_rels/.rels']),
        '[Content_Types].xml': strToU8(PARTS['[Content_Types].xml'])
    }, { level: 0 });
}

/** Name of the first local file header, i.e. the first part a streaming reader sees. */
function firstEntryName(zip: Uint8Array): string {
    const nameLength = zip[26] | (zip[27] << 8);
    return Buffer.from(zip.subarray(30, 30 + nameLength)).toString('utf8');
}

describe('normalizePresentationPackage', () => {
    it('puts [Content_Types].xml first, then the package relationships, without folder entries', () => {
        const normalized = normalizePresentationPackage(messyPackage());
        assert.ok(normalized);
        assert.equal(firstEntryName(normalized), '[Content_Types].xml');
        const names = Object.keys(unzipSync(normalized));
        assert.equal(names[1], '_rels/.rels');
        assert.deepEqual([...names].sort(), Object.keys(PARTS).sort());
    });

    it('keeps every part byte for byte', () => {
        const parts = unzipSync(normalizePresentationPackage(messyPackage())!);
        for (const [name, content] of Object.entries(PARTS)) {
            assert.equal(Buffer.from(parts[name]).toString('utf8'), content, name);
        }
    });

    it('compresses the XML parts', () => {
        const big = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'ppt/slides/slide1.xml': strToU8('<a/>'.repeat(5000)) }, { level: 0 });
        assert.ok(normalizePresentationPackage(big)!.length < big.length / 10);
    });

    it('is stable when run again', () => {
        const once = normalizePresentationPackage(messyPackage())!;
        const twice = normalizePresentationPackage(once)!;
        assert.deepEqual(Object.keys(unzipSync(twice)), Object.keys(unzipSync(once)));
    });

    it('leaves files it cannot read as a .pptx alone', () => {
        // Binary .ppt (OLE compound file)
        assert.equal(normalizePresentationPackage(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), null);
        // A zip that is not an Office package
        assert.equal(normalizePresentationPackage(zipSync({ 'notes.txt': strToU8('x') })), null);
        // A truncated zip
        assert.equal(normalizePresentationPackage(messyPackage().subarray(0, 60)), null);
    });
});

describe('normalizePresentationFile', () => {
    it('rewrites the file in place and returns the new size', async () => {
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pptx-'));
        try {
            const file = path.join(dir, '.presentation-1.pptx.part');
            await fs.promises.writeFile(file, messyPackage());
            const size = await normalizePresentationFile(file);
            const written = await fs.promises.readFile(file);
            assert.equal(size, written.length);
            assert.equal(firstEntryName(written), '[Content_Types].xml');
        } finally {
            await fs.promises.rm(dir, { recursive: true, force: true });
        }
    });

    it('keeps a binary .ppt untouched', async () => {
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ppt-'));
        try {
            const file = path.join(dir, 'presentation-1.ppt');
            const original = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]);
            await fs.promises.writeFile(file, original);
            assert.equal(await normalizePresentationFile(file), original.length);
            assert.deepEqual(await fs.promises.readFile(file), original);
        } finally {
            await fs.promises.rm(dir, { recursive: true, force: true });
        }
    });
});
