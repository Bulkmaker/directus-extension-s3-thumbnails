import { describe, it, expect } from 'vitest';
import { isImage, isVideo, isThumbnailSource, buildThumbnailKey, getBasename } from '../src/utils/mime.js';
import { getVideoConfig } from '../src/utils/config.js';

describe('mime', () => {
	it('detects video', () => {
		expect(isVideo('video/mp4')).toBe(true);
		expect(isVideo('video/quicktime')).toBe(true);
		expect(isVideo('VIDEO/WEBM')).toBe(true);
		expect(isVideo('image/png')).toBe(false);
		expect(isVideo('application/pdf')).toBe(false);
		expect(isVideo(null)).toBe(false);
		expect(isVideo(undefined)).toBe(false);
	});

	it('images stay thumbnail sources regardless of the option', () => {
		expect(isImage('image/jpeg')).toBe(true);
		expect(isThumbnailSource('image/jpeg', false)).toBe(true);
		expect(isThumbnailSource('image/jpeg', true)).toBe(true);
	});

	it('video is a thumbnail source only when posters are enabled', () => {
		expect(isThumbnailSource('video/mp4', false)).toBe(false);
		expect(isThumbnailSource('video/mp4', true)).toBe(true);
		expect(isThumbnailSource('application/pdf', true)).toBe(false);
	});

	it('builds the same key for video posters as for image thumbnails', () => {
		const base = getBasename('3f1c2a7e-0000-4000-8000-aaaaaaaaaaaa.mp4');
		expect(base).toBe('3f1c2a7e-0000-4000-8000-aaaaaaaaaaaa');
		expect(buildThumbnailKey('', 'card', base, 'webp')).toBe('card/3f1c2a7e-0000-4000-8000-aaaaaaaaaaaa.webp');
		expect(buildThumbnailKey('site', 'hero', base, 'jpg')).toBe('site/hero/3f1c2a7e-0000-4000-8000-aaaaaaaaaaaa.jpg');
		// prefix для удаления (формат пустой) заканчивается точкой
		expect(buildThumbnailKey('', 'card', base, '')).toBe('card/3f1c2a7e-0000-4000-8000-aaaaaaaaaaaa.');
	});
});

describe('getVideoConfig', () => {
	it('is disabled by default', () => {
		const c = getVideoConfig({});
		expect(c.enabled).toBe(false);
		expect(c.maxBytes).toBe(500 * 1024 * 1024);
		expect(c.timeoutMs).toBe(60000);
		expect(c.allowDownload).toBe(true);
	});

	it('reads env', () => {
		const c = getVideoConfig({
			THUMBNAILS_VIDEO_POSTERS: 'true',
			THUMBNAILS_VIDEO_MAX_MB: '100',
			THUMBNAILS_VIDEO_TIMEOUT_SEC: '15',
			THUMBNAILS_FFMPEG_PATH: '/usr/bin/ffmpeg',
			THUMBNAILS_FFMPEG_DOWNLOAD: 'false',
		});
		expect(c.enabled).toBe(true);
		expect(c.maxBytes).toBe(100 * 1024 * 1024);
		expect(c.timeoutMs).toBe(15000);
		expect(c.ffmpegPath).toBe('/usr/bin/ffmpeg');
		expect(c.allowDownload).toBe(false);
	});

	it('falls back on garbage values', () => {
		const c = getVideoConfig({ THUMBNAILS_VIDEO_POSTERS: 'yes', THUMBNAILS_VIDEO_MAX_MB: 'abc', THUMBNAILS_VIDEO_TIMEOUT_SEC: '-5' });
		expect(c.enabled).toBe(false);
		expect(c.maxBytes).toBe(500 * 1024 * 1024);
		expect(c.timeoutMs).toBe(60000);
	});
});
