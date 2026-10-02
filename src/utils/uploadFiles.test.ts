import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { isTempUploadName, resolveManagedMediaFile, toTempUploadName } from './uploadFiles.js';
import { isUploadedVideoPath } from './mediaValidation.js';

const UPLOADS_DIR = path.resolve('fake-root', 'uploads');

describe('temporary upload names', () => {
    it('hides the file behind a leading dot and a .part suffix', () => {
        assert.equal(toTempUploadName('video-1-2.mp4'), '.video-1-2.mp4.part');
    });

    it('recognizes only temporary names', () => {
        assert.equal(isTempUploadName(toTempUploadName('presentation-1-2.pptx')), true);
        assert.equal(isTempUploadName('video-1-2.mp4'), false);
        assert.equal(isTempUploadName('.video-1-2.mp4'), false);
        assert.equal(isTempUploadName('video-1-2.mp4.part'), false);
    });

    it('can never be stored as a material media_url', () => {
        assert.equal(isUploadedVideoPath(`/uploads/videos/${toTempUploadName('video-1-2.mp4')}`), false);
    });
});

describe('resolveManagedMediaFile', () => {
    it('maps uploaded videos and presentations to a direct child of their folder', () => {
        assert.equal(
            resolveManagedMediaFile('/uploads/videos/video-1-2.mp4', UPLOADS_DIR),
            path.join(UPLOADS_DIR, 'videos', 'video-1-2.mp4')
        );
        assert.equal(
            resolveManagedMediaFile('/uploads/presentations/presentation-1-2.pptx', UPLOADS_DIR),
            path.join(UPLOADS_DIR, 'presentations', 'presentation-1-2.pptx')
        );
    });

    it('ignores external links, PDFs, images and other folders', () => {
        const values = [
            'https://youtu.be/dQw4w9WgXcQ',
            'https://vimeo.com/76979871',
            'https://evil.com/uploads/videos/video-1.mp4',
            '/uploads/pdfs/pdf-1.pdf',
            '/uploads/images/cover.png',
            'uploads/videos/video-1.mp4',
            '/uploads/videos/',
            ''
        ];
        for (const value of values) {
            assert.equal(resolveManagedMediaFile(value, UPLOADS_DIR), null, value);
        }
    });

    it('never resolves outside the media folders', () => {
        const values = [
            '/uploads/videos/..',
            '/uploads/videos/../pdfs/book.pdf',
            '/uploads/videos/../../etc/passwd',
            '/uploads/presentations/../../../secret.pptx',
            '/uploads/videos/..%2F..%2Fsecret',
            '/uploads/videos/a/b.mp4',
            '/uploads/videos/a\\..\\..\\b.mp4',
            '/uploads/videos/.hidden.mp4',
            '/uploads/videos/.',
            '/uploads/videos/video.mp4\n'
        ];
        for (const value of values) {
            assert.equal(resolveManagedMediaFile(value, UPLOADS_DIR), null, value);
        }
    });
});
