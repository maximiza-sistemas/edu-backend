import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_MEDIA_URL_LENGTH,
    MAX_PDF_URL_LENGTH,
    MEDIA_ERRORS,
    getFileExtension,
    isAllowedPresentationUpload,
    isAllowedVideoLink,
    isAllowedVideoUpload,
    isContentType,
    isUploadedPresentationPath,
    isUploadedVideoPath,
    normalizeBookMedia
} from './mediaValidation.js';

const YOUTUBE_ID = 'dQw4w9WgXcQ';

describe('isContentType', () => {
    it('accepts the three supported formats', () => {
        assert.equal(isContentType('pdf'), true);
        assert.equal(isContentType('video'), true);
        assert.equal(isContentType('pptx'), true);
    });

    it('rejects anything else', () => {
        for (const value of ['', 'PDF', 'ppt', 'audio', null, undefined, 1, {}, ['pdf']]) {
            assert.equal(isContentType(value), false, `expected ${JSON.stringify(value)} to be rejected`);
        }
    });
});

describe('isAllowedVideoLink', () => {
    it('accepts YouTube watch, short, embed, shorts and live links', () => {
        const links = [
            `https://www.youtube.com/watch?v=${YOUTUBE_ID}`,
            `https://youtube.com/watch?v=${YOUTUBE_ID}&t=42s`,
            `https://m.youtube.com/watch?v=${YOUTUBE_ID}`,
            `https://music.youtube.com/watch?v=${YOUTUBE_ID}`,
            `http://www.youtube.com/watch?v=${YOUTUBE_ID}`,
            `https://youtu.be/${YOUTUBE_ID}`,
            `https://youtu.be/${YOUTUBE_ID}?si=abc`,
            `https://www.youtube.com/embed/${YOUTUBE_ID}`,
            `https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}`,
            `https://youtube-nocookie.com/embed/${YOUTUBE_ID}`,
            `https://www.youtube.com/shorts/${YOUTUBE_ID}`,
            `https://www.youtube.com/live/${YOUTUBE_ID}`,
            `https://www.youtube.com/v/${YOUTUBE_ID}`,
            `  https://WWW.YouTube.com/watch?v=${YOUTUBE_ID}  `
        ];
        for (const link of links) {
            assert.equal(isAllowedVideoLink(link), true, link);
        }
    });

    it('accepts Vimeo links with a numeric video id', () => {
        const links = [
            'https://vimeo.com/76979871',
            'https://www.vimeo.com/76979871',
            'https://vimeo.com/76979871/abcdef1234',
            'https://player.vimeo.com/video/76979871',
            'https://player.vimeo.com/video/76979871?h=abcdef1234',
            'https://vimeo.com/channels/staffpicks/76979871',
            'https://vimeo.com/showcase/456/video/76979871',
            'https://vimeo.com/album/456/video/76979871'
        ];
        for (const link of links) {
            assert.equal(isAllowedVideoLink(link), true, link);
        }
    });

    it('rejects YouTube and Vimeo links without a playable video id', () => {
        const links = [
            'https://www.youtube.com/',
            'https://www.youtube.com/watch',
            'https://www.youtube.com/watch?v=short',
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ<script>',
            'https://www.youtube.com/channel/UC1234567890',
            'https://www.youtube.com/embed/',
            'https://youtu.be/',
            'https://youtu.be/tooShort',
            'https://vimeo.com/',
            'https://vimeo.com/channels/staffpicks'
        ];
        for (const link of links) {
            assert.equal(isAllowedVideoLink(link), false, link);
        }
    });

    it('rejects Vimeo showcase, album, channel, group and event links, like the frontend player', () => {
        const links = [
            'https://vimeo.com/showcase/11223344',
            'https://vimeo.com/album/5566778',
            'https://vimeo.com/channels/1234567',
            'https://vimeo.com/groups/112233',
            'https://vimeo.com/event/998877',
            'https://vimeo.com/showcase/456',
            'https://www.vimeo.com/album/456/'
        ];
        for (const link of links) {
            assert.equal(isAllowedVideoLink(link), false, link);
        }
    });

    it('rejects look-alike and unrelated hosts', () => {
        const links = [
            `https://youtube.com.evil.com/watch?v=${YOUTUBE_ID}`,
            `https://evil.com/youtube.com/watch?v=${YOUTUBE_ID}`,
            `https://evilyoutube.com/watch?v=${YOUTUBE_ID}`,
            `https://www.youtube.com.evil.com/embed/${YOUTUBE_ID}`,
            `https://youtu.be.evil.com/${YOUTUBE_ID}`,
            'https://vimeo.com.evil.com/76979871',
            'https://evil.com/76979871',
            'https://notvimeo.com/76979871',
            `https://img.youtube.com/vi/${YOUTUBE_ID}/hqdefault.jpg`,
            `https://evil.com/?u=https://www.youtube.com/watch?v=${YOUTUBE_ID}`
        ];
        for (const link of links) {
            assert.equal(isAllowedVideoLink(link), false, link);
        }
    });

    it('rejects non-http(s) schemes and malformed input', () => {
        const links = [
            'javascript:alert(1)',
            `javascript://www.youtube.com/watch?v=${YOUTUBE_ID}%0Aalert(1)`,
            'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
            `ftp://www.youtube.com/watch?v=${YOUTUBE_ID}`,
            `file:///www.youtube.com/watch?v=${YOUTUBE_ID}`,
            `//www.youtube.com/watch?v=${YOUTUBE_ID}`,
            `www.youtube.com/watch?v=${YOUTUBE_ID}`,
            '/uploads/videos/video-1.mp4',
            '',
            'not a url'
        ];
        for (const link of links) {
            assert.equal(isAllowedVideoLink(link), false, link);
        }
    });

    it('rejects links longer than the column limit', () => {
        const link = `https://www.youtube.com/watch?v=${YOUTUBE_ID}&x=${'a'.repeat(MAX_MEDIA_URL_LENGTH)}`;
        assert.equal(isAllowedVideoLink(link), false);
    });
});

describe('uploaded file paths', () => {
    it('accepts files written by the upload endpoints', () => {
        assert.equal(isUploadedVideoPath('/uploads/videos/video-1700000000000-123456789.mp4'), true);
        assert.equal(isUploadedVideoPath('/uploads/videos/aula_1.webm'), true);
        assert.equal(isUploadedPresentationPath('/uploads/presentations/presentation-1700000000000-123456789.pptx'), true);
        assert.equal(isUploadedPresentationPath('/uploads/presentations/slides.ppt'), true);
    });

    it('rejects path traversal and hidden names', () => {
        const paths = [
            '/uploads/videos/..',
            '/uploads/videos/../pdfs/book.pdf',
            '/uploads/videos/..%2F..%2Fsecret',
            '/uploads/videos/video..mp4',
            '/uploads/videos/.',
            '/uploads/videos/.hidden.mp4',
            '/uploads/videos/a/b.mp4',
            '/uploads/videos/a\\b.mp4'
        ];
        for (const value of paths) {
            assert.equal(isUploadedVideoPath(value), false, value);
            assert.equal(isUploadedPresentationPath(value.replace('/videos/', '/presentations/')), false, value);
        }
    });

    it('rejects files outside the expected folder', () => {
        assert.equal(isUploadedVideoPath('/uploads/presentations/slides.pptx'), false);
        assert.equal(isUploadedVideoPath('/uploads/pdfs/book.pdf'), false);
        assert.equal(isUploadedVideoPath('uploads/videos/video.mp4'), false);
        assert.equal(isUploadedVideoPath('https://evil.com/uploads/videos/video.mp4'), false);
        assert.equal(isUploadedVideoPath('/uploads/videos/'), false);
        assert.equal(isUploadedVideoPath('/uploads/videos/video.mp4?x=1'), false);
        assert.equal(isUploadedVideoPath('/uploads/videos/video.mp4\n'), false);
        assert.equal(isUploadedPresentationPath('/uploads/videos/video.mp4'), false);
        assert.equal(isUploadedPresentationPath('/uploads/images/cover.png'), false);
    });
});

describe('upload file type checks', () => {
    it('reads the lowercased extension', () => {
        assert.equal(getFileExtension('Aula.MP4'), '.mp4');
        assert.equal(getFileExtension('slides.final.PPTX'), '.pptx');
        assert.equal(getFileExtension('sem-extensao'), '');
    });

    it('accepts videos only when extension and MIME type both match', () => {
        assert.equal(isAllowedVideoUpload('aula.mp4', 'video/mp4'), true);
        assert.equal(isAllowedVideoUpload('aula.WEBM', 'video/webm'), true);
        assert.equal(isAllowedVideoUpload('aula.ogv', 'video/ogg'), true);
        assert.equal(isAllowedVideoUpload('aula.m4v', 'video/x-m4v'), true);
        assert.equal(isAllowedVideoUpload('aula.mp4', 'application/octet-stream'), true);
        assert.equal(isAllowedVideoUpload('aula.exe', 'video/mp4'), false);
        assert.equal(isAllowedVideoUpload('aula.mp4.html', 'video/mp4'), false);
        assert.equal(isAllowedVideoUpload('aula.mp4', 'text/html'), false);
        assert.equal(isAllowedVideoUpload('aula.mov', 'video/quicktime'), false);
    });

    it('accepts presentations with PowerPoint or generic MIME types', () => {
        assert.equal(isAllowedPresentationUpload('slides.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'), true);
        assert.equal(isAllowedPresentationUpload('slides.ppt', 'application/vnd.ms-powerpoint'), true);
        assert.equal(isAllowedPresentationUpload('slides.PPTX', 'application/octet-stream'), true);
        assert.equal(isAllowedPresentationUpload('slides.pptx', 'text/plain'), false);
        assert.equal(isAllowedPresentationUpload('slides.pptx', ''), false);
        assert.equal(isAllowedPresentationUpload('slides.pdf', 'application/pdf'), false);
        assert.equal(isAllowedPresentationUpload('slides.pptx', 'text/html'), false);
        assert.equal(isAllowedPresentationUpload('slides.html', 'application/octet-stream'), false);
    });
});

describe('normalizeBookMedia', () => {
    it('rejects an invalid content type', () => {
        for (const value of ['', 'audio', 'PDF', null, undefined, 42]) {
            assert.deepEqual(normalizeBookMedia(value, null, null), { ok: false, error: MEDIA_ERRORS.invalidContentType });
        }
    });

    describe('pdf', () => {
        it('keeps pdf_url as given and clears media_url', () => {
            assert.deepEqual(
                normalizeBookMedia('pdf', `https://youtu.be/${YOUTUBE_ID}`, '/uploads/pdfs/pdf-1.pdf'),
                { ok: true, content_type: 'pdf', media_url: null, pdf_url: '/uploads/pdfs/pdf-1.pdf' }
            );
        });

        it('does not validate legacy PDF URLs', () => {
            const legacy = 'https://drive.example.com/some file.pdf';
            assert.deepEqual(
                normalizeBookMedia('pdf', undefined, legacy),
                { ok: true, content_type: 'pdf', media_url: null, pdf_url: legacy }
            );
        });

        it('stores a missing or empty pdf_url as null', () => {
            const expected = { ok: true, content_type: 'pdf', media_url: null, pdf_url: null };
            assert.deepEqual(normalizeBookMedia('pdf', undefined, undefined), expected);
            assert.deepEqual(normalizeBookMedia('pdf', null, null), expected);
            assert.deepEqual(normalizeBookMedia('pdf', '', ''), expected);
        });

        it('rejects a non-string pdf_url', () => {
            assert.deepEqual(normalizeBookMedia('pdf', null, 123), { ok: false, error: MEDIA_ERRORS.invalidPdfUrl });
            assert.deepEqual(normalizeBookMedia('pdf', null, { url: 'x' }), { ok: false, error: MEDIA_ERRORS.invalidPdfUrl });
        });

        it('rejects a pdf_url longer than its column', () => {
            const atLimit = `/uploads/pdfs/${'a'.repeat(MAX_PDF_URL_LENGTH - '/uploads/pdfs/.pdf'.length)}.pdf`;
            assert.equal(atLimit.length, MAX_PDF_URL_LENGTH);
            assert.deepEqual(
                normalizeBookMedia('pdf', null, atLimit),
                { ok: true, content_type: 'pdf', media_url: null, pdf_url: atLimit }
            );
            assert.deepEqual(normalizeBookMedia('pdf', null, `${atLimit}x`), { ok: false, error: MEDIA_ERRORS.pdfUrlTooLong });
        });
    });

    describe('video', () => {
        it('accepts an uploaded file and clears pdf_url', () => {
            assert.deepEqual(
                normalizeBookMedia('video', '/uploads/videos/video-1.mp4', '/uploads/pdfs/pdf-1.pdf'),
                { ok: true, content_type: 'video', media_url: '/uploads/videos/video-1.mp4', pdf_url: null }
            );
        });

        it('accepts a YouTube or Vimeo link, trimmed', () => {
            assert.deepEqual(
                normalizeBookMedia('video', `  https://youtu.be/${YOUTUBE_ID} `, null),
                { ok: true, content_type: 'video', media_url: `https://youtu.be/${YOUTUBE_ID}`, pdf_url: null }
            );
            assert.deepEqual(
                normalizeBookMedia('video', 'https://vimeo.com/76979871', undefined),
                { ok: true, content_type: 'video', media_url: 'https://vimeo.com/76979871', pdf_url: null }
            );
        });

        it('treats a missing or blank media_url as no media yet', () => {
            const expected = { ok: true, content_type: 'video', media_url: null, pdf_url: null };
            assert.deepEqual(normalizeBookMedia('video', undefined, undefined), expected);
            assert.deepEqual(normalizeBookMedia('video', null, '/uploads/pdfs/pdf-1.pdf'), expected);
            assert.deepEqual(normalizeBookMedia('video', '', null), expected);
            assert.deepEqual(normalizeBookMedia('video', '   ', null), expected);
        });

        it('rejects other sites, schemes, folders and traversal', () => {
            const values = [
                `https://youtube.com.evil.com/watch?v=${YOUTUBE_ID}`,
                'https://example.com/video.mp4',
                'javascript:alert(1)',
                'data:video/mp4;base64,AAAA',
                '/uploads/presentations/presentation-1.pptx',
                '/uploads/pdfs/pdf-1.pdf',
                '/uploads/videos/../pdfs/pdf-1.pdf'
            ];
            for (const value of values) {
                assert.deepEqual(normalizeBookMedia('video', value, null), { ok: false, error: MEDIA_ERRORS.invalidVideo }, value);
            }
        });

        it('rejects a non-string or oversized media_url', () => {
            assert.deepEqual(normalizeBookMedia('video', 42, null), { ok: false, error: MEDIA_ERRORS.invalidMediaUrl });
            assert.deepEqual(normalizeBookMedia('video', ['/uploads/videos/a.mp4'], null), { ok: false, error: MEDIA_ERRORS.invalidMediaUrl });
            assert.deepEqual(
                normalizeBookMedia('video', `/uploads/videos/${'a'.repeat(MAX_MEDIA_URL_LENGTH)}.mp4`, null),
                { ok: false, error: MEDIA_ERRORS.mediaUrlTooLong }
            );
        });
    });

    describe('pptx', () => {
        it('accepts an uploaded presentation and clears pdf_url', () => {
            assert.deepEqual(
                normalizeBookMedia('pptx', '/uploads/presentations/presentation-1.pptx', '/uploads/pdfs/pdf-1.pdf'),
                { ok: true, content_type: 'pptx', media_url: '/uploads/presentations/presentation-1.pptx', pdf_url: null }
            );
        });

        it('treats a missing media_url as no presentation yet', () => {
            assert.deepEqual(
                normalizeBookMedia('pptx', null, null),
                { ok: true, content_type: 'pptx', media_url: null, pdf_url: null }
            );
        });

        it('rejects links and files outside the presentations folder', () => {
            const values = [
                'https://example.com/slides.pptx',
                `https://youtu.be/${YOUTUBE_ID}`,
                '/uploads/videos/video-1.mp4',
                '/uploads/presentations/../../etc/passwd',
                '/uploads/presentations/'
            ];
            for (const value of values) {
                assert.deepEqual(normalizeBookMedia('pptx', value, null), { ok: false, error: MEDIA_ERRORS.invalidPresentation }, value);
            }
        });
    });
});
