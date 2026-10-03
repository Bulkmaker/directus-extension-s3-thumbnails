import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/s3.js', () => ({
	createS3Client: vi.fn(() => ({})),
	uploadToS3: vi.fn(async () => {}),
	existsInS3: vi.fn(async () => false),
	getObjectMetadata: vi.fn(async () => ({ size: 1024 })),
	downloadToFile: vi.fn(async () => 1024),
	withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
	savePresetConfig: vi.fn(async () => {}),
	deleteS3Prefix: vi.fn(async () => 0),
	listS3Objects: vi.fn(async () => []),
	deleteFromS3: vi.fn(async () => {}),
}));
vi.mock('../src/services/ffmpeg.js', () => ({
	resolveFfmpeg: vi.fn(async () => '/fake/ffmpeg'),
	grabPosterFrame: vi.fn(async () => Buffer.from('frame')),
}));
vi.mock('../src/services/range-proxy.js', () => ({
	startRangeProxy: vi.fn(async () => ({ url: 'http://127.0.0.1:5555/video', close: vi.fn(async () => {}) })),
}));
vi.mock('../src/services/image-pipeline.js', () => ({
	processBufferWithPreset: vi.fn(async (_b: Buffer, _p: unknown, format: string) => ({
		buffer: Buffer.from('out-' + format),
		format,
		width: 400,
		height: 300,
	})),
}));

import * as s3 from '../src/services/s3.js';
import * as ff from '../src/services/ffmpeg.js';
import { generateVideoPostersForFile } from '../src/services/video-poster.js';
import { createUploadHandler, generateThumbnailsForFile } from '../src/hooks/on-upload.js';

const presets = [
	{ key: 'card', width: 400, height: 300, format: 'webp' },
	{ key: 'hero', width: 1600, format: 'jpg' },
];

const database: any = (table: string) => ({
	select: () => ({ first: async () => (table === 'directus_settings' ? { storage_asset_presets: presets } : null) }),
});

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function ctx(extraEnv: Record<string, string> = {}) {
	return {
		database,
		env: {
			STORAGE_S3_DRIVER: 's3',
			STORAGE_S3_BUCKET: 'bucket',
			STORAGE_S3_ENDPOINT: 'http://s3.local',
			STORAGE_S3_ROOT: '',
			...extraEnv,
		} as Record<string, string>,
		logger,
		services: {},
		getSchema: async () => ({}),
	};
}

const file = {
	id: 'abc',
	filename_disk: '3f1c2a7e-0000-4000-8000-aaaaaaaaaaaa.mp4',
	filename_download: 'clip.mp4',
	type: 'video/mp4',
};

beforeEach(() => {
	vi.clearAllMocks();
	(s3.existsInS3 as any).mockResolvedValue(false);
	(s3.getObjectMetadata as any).mockResolvedValue({ size: 1024 });
	(ff.grabPosterFrame as any).mockResolvedValue(Buffer.from('frame'));
});

describe('video posters: option off (default)', () => {
	it('does nothing in generateVideoPostersForFile', async () => {
		const r = await generateVideoPostersForFile(file, ctx());
		expect(r).toEqual({ generated: 0, skipped: 0, errors: 0 });
		expect(ff.grabPosterFrame).not.toHaveBeenCalled();
		expect(s3.uploadToS3).not.toHaveBeenCalled();
		expect(s3.existsInS3).not.toHaveBeenCalled();
	});

	it('does nothing in generateThumbnailsForFile (regeneration)', async () => {
		const r = await generateThumbnailsForFile(file as any, ctx());
		expect(r).toEqual({ generated: 0, skipped: 0 });
		expect(s3.uploadToS3).not.toHaveBeenCalled();
	});

	it('upload handler ignores video', async () => {
		const handler = createUploadHandler(ctx());
		await handler({ payload: file as any, key: 'abc', collection: 'directus_files' });
		expect(s3.uploadToS3).not.toHaveBeenCalled();
		expect(ff.resolveFfmpeg).not.toHaveBeenCalled();
	});
});

describe('video posters: option on', () => {
	const on = { THUMBNAILS_VIDEO_POSTERS: 'true' };

	it('uploads one variant per preset under the image key convention', async () => {
		const r = await generateVideoPostersForFile(file, ctx(on));
		expect(r).toEqual({ generated: 2, skipped: 0, errors: 0 });

		// кадр снимается ОДИН раз, через локальный Range-прокси
		expect(ff.grabPosterFrame).toHaveBeenCalledTimes(1);
		expect((ff.grabPosterFrame as any).mock.calls[0][0]).toMatchObject({
			ffmpegPath: '/fake/ffmpeg',
			input: 'http://127.0.0.1:5555/video',
		});

		const uploaded = (s3.uploadToS3 as any).mock.calls.map((c: any[]) => [c[2], c[4]]);
		expect(uploaded).toEqual([
			['card/3f1c2a7e-0000-4000-8000-aaaaaaaaaaaa.webp', 'image/webp'],
			['hero/3f1c2a7e-0000-4000-8000-aaaaaaaaaaaa.jpg', 'image/jpeg'],
		]);
	});

	it('skips existing variants and does not run ffmpeg if all exist', async () => {
		(s3.existsInS3 as any).mockResolvedValue(true);
		const r = await generateVideoPostersForFile(file, ctx(on));
		expect(r).toEqual({ generated: 0, skipped: 2, errors: 0 });
		expect(ff.grabPosterFrame).not.toHaveBeenCalled();
	});

	it('force regenerates existing variants', async () => {
		(s3.existsInS3 as any).mockResolvedValue(true);
		const r = await generateVideoPostersForFile(file, ctx(on), { force: true });
		expect(r.generated).toBe(2);
	});

	it('does not run ffmpeg for videos over THUMBNAILS_VIDEO_MAX_MB', async () => {
		(s3.getObjectMetadata as any).mockResolvedValue({ size: 3 * 1024 * 1024 });
		const r = await generateVideoPostersForFile(file, ctx({ ...on, THUMBNAILS_VIDEO_MAX_MB: '2' }));
		expect(r.generated).toBe(0);
		expect(ff.grabPosterFrame).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalled();
	});

	it('ffmpeg failure does not throw and is reported as an error', async () => {
		(ff.grabPosterFrame as any).mockRejectedValue(new Error('ffmpeg exited with code 1: Invalid data'));
		await expect(generateVideoPostersForFile(file, ctx(on))).resolves.toMatchObject({ generated: 0, errors: 1 });
		expect(logger.error).toHaveBeenCalled();
		expect(s3.uploadToS3).not.toHaveBeenCalled();
	});

	it('falls back to a temp file when streaming fails, and cleans it up', async () => {
		const proxy = await import('../src/services/range-proxy.js');
		(proxy.startRangeProxy as any).mockRejectedValueOnce(new Error('listen failed'));
		const r = await generateVideoPostersForFile(file, ctx(on));
		expect(r).toMatchObject({ generated: 2, errors: 0 });
		expect(s3.downloadToFile).toHaveBeenCalledTimes(1);
		const tmpPath = (s3.downloadToFile as any).mock.calls[0][3] as string;
		const { existsSync } = await import('node:fs');
		expect(existsSync(tmpPath)).toBe(false);
		expect(existsSync(tmpPath.replace(/\/source$/, ''))).toBe(false);
	});

	it('missing ffmpeg binary does not throw', async () => {
		(ff.resolveFfmpeg as any).mockRejectedValueOnce(new Error('ffmpeg not found'));
		await expect(generateVideoPostersForFile(file, ctx(on))).resolves.toMatchObject({ generated: 0, errors: 1 });
	});

	it('upload handler survives ffmpeg failure (does not reject)', async () => {
		(ff.grabPosterFrame as any).mockRejectedValue(new Error('boom'));
		const handler = createUploadHandler(ctx(on));
		await expect(handler({ payload: file as any, key: 'abc', collection: 'directus_files' })).resolves.toBeUndefined();
	});

	it('upload handler generates posters for video', async () => {
		const handler = createUploadHandler(ctx(on));
		await handler({ payload: file as any, key: 'abc', collection: 'directus_files' });
		expect(s3.uploadToS3).toHaveBeenCalledTimes(2);
	});

	it('a failure of one preset does not block the others', async () => {
		(s3.uploadToS3 as any).mockRejectedValueOnce(new Error('S3 down')).mockResolvedValue(undefined);
		const r = await generateVideoPostersForFile(file, ctx(on));
		expect(r).toMatchObject({ generated: 1, errors: 1 });
	});
});
