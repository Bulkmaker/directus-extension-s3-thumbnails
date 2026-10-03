import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, stat, readFile, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { buildFfmpegArgs, extractFrame, grabPosterFrame, downloadFfmpeg, checkBinary, resolveFfmpeg, resetFfmpegCache } from '../src/services/ffmpeg.js';
import { processBufferWithPreset } from '../src/services/image-pipeline.js';

const logger = { info: () => {}, warn: () => {}, error: () => {} };

// Реальный ffmpeg: FFMPEG_TEST_BIN (напр. бинарь ffmpeg-static) или `ffmpeg` из PATH. Нет — тесты пропускаются.
function findFfmpeg(): string | null {
	const candidates = [process.env.FFMPEG_TEST_BIN, 'ffmpeg', '/opt/homebrew/bin/ffmpeg'].filter(Boolean) as string[];
	for (const c of candidates) {
		if (spawnSync(c, ['-version']).status === 0) return c;
	}
	return null;
}
const FFMPEG = findFfmpeg();
const realIt = FFMPEG ? it : it.skip;

describe('buildFfmpegArgs', () => {
	it('puts -ss before -i and outputs one PNG to stdout', () => {
		const args = buildFfmpegArgs('/tmp/x.mp4', 1);
		expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
		expect(args).toContain('-frames:v');
		expect(args[args.indexOf('-frames:v') + 1]).toBe('1');
		expect(args[args.length - 1]).toBe('pipe:1');
		expect(args).not.toContain('-protocol_whitelist');
	});

	it('restricts protocols for URLs', () => {
		const args = buildFfmpegArgs('https://s3.example/b/k.mp4?X-Amz=1', 0);
		expect(args).toContain('-protocol_whitelist');
		expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('http,https,tcp,tls,crypto');
	});
});

describe('ffmpeg errors', () => {
	it('rejects on a missing binary', async () => {
		await expect(extractFrame({ ffmpegPath: '/nonexistent/ffmpeg', input: '/tmp/x.mp4', seekSec: 0, timeoutMs: 5000 })).rejects.toThrow();
	});

	it('resolveFfmpeg fails clearly when THUMBNAILS_FFMPEG_PATH is bad', async () => {
		resetFfmpegCache();
		await expect(resolveFfmpeg({ ffmpegPath: '/nonexistent/ffmpeg', allowDownload: false }, logger)).rejects.toThrow(/THUMBNAILS_FFMPEG_PATH/);
		resetFfmpegCache();
	});

	it('downloadFfmpeg rejects on checksum mismatch and leaves no file', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'ffdl-'));
		const fakeFetch = (async () =>
			new Response(gzipSync(Buffer.from('not ffmpeg')), { status: 200 })) as unknown as typeof fetch;
		await expect(downloadFfmpeg({ allowDownload: true, ffmpegDir: dir }, logger, fakeFetch)).rejects.toThrow(/checksum mismatch/);
		const { readdir } = await import('node:fs/promises');
		expect(await readdir(dir)).toEqual([]);
		await rm(dir, { recursive: true, force: true });
	});

	it('downloadFfmpeg rejects on HTTP error', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'ffdl-'));
		const fakeFetch = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
		await expect(downloadFfmpeg({ allowDownload: true, ffmpegDir: dir }, logger, fakeFetch)).rejects.toThrow(/HTTP 404/);
		await rm(dir, { recursive: true, force: true });
	});

	// Ручная проверка реального скачивания (≈25 МБ): FFMPEG_DOWNLOAD_TEST=1 npm test
	(process.env.FFMPEG_DOWNLOAD_TEST ? it : it.skip)('downloads the pinned ffmpeg, verifies sha256 and runs it', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'ffdl-'));
		const bin = await downloadFfmpeg({ allowDownload: true, ffmpegDir: dir }, logger);
		expect(await checkBinary(bin)).toBe(true);
		await rm(dir, { recursive: true, force: true });
	}, 300000);
});

describe('real ffmpeg frame extraction', () => {
	let dir: string;
	let mp4: string;
	let shortMp4: string;
	let server: Server;
	let port: number;
	let bytesServed = 0;
	let rangeRequests = 0;

	beforeAll(async () => {
		if (!FFMPEG) return;
		dir = await mkdtemp(join(tmpdir(), 'ffposter-'));
		mp4 = join(dir, 'test.mp4');
		shortMp4 = join(dir, 'short.mp4');
		const gen = (out: string, dur: number) =>
			spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=duration=${dur}:size=1280x720:rate=25`, '-pix_fmt', 'yuv420p', out]);
		expect(gen(mp4, 5).status).toBe(0);
		expect(gen(shortMp4, 0.4).status).toBe(0);

		// HTTP-сервер с поддержкой Range (как S3/MinIO)
		server = createServer(async (req, res) => {
			const file = join(dir, (req.url || '').split('?')[0].replace(/^\//, ''));
			if (!existsSync(file)) { res.statusCode = 404; return res.end(); }
			const size = (await stat(file)).size;
			const range = req.headers.range;
			if (range) {
				rangeRequests++;
				const m = /bytes=(\d*)-(\d*)/.exec(range)!;
				const start = m[1] ? parseInt(m[1], 10) : 0;
				const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
				res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': 'video/mp4' });
				bytesServed += end - start + 1;
				createReadStream(file, { start, end }).pipe(res);
			} else {
				res.writeHead(200, { 'Accept-Ranges': 'bytes', 'Content-Length': size, 'Content-Type': 'video/mp4' });
				bytesServed += size;
				createReadStream(file).pipe(res);
			}
		});
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		port = (server.address() as any).port;
	});

	afterAll(async () => {
		if (server) await new Promise((r) => server.close(r));
		if (dir) await rm(dir, { recursive: true, force: true });
	});

	realIt('extracts a PNG frame from a local file', async () => {
		const png = await grabPosterFrame({ ffmpegPath: FFMPEG!, input: mp4, timeoutMs: 30000 });
		expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
		const meta = await sharp(png).metadata();
		expect(meta.width).toBe(1280);
		expect(meta.height).toBe(720);
	});

	realIt('extracts a frame over HTTP (Range)', async () => {
		bytesServed = 0; rangeRequests = 0;
		const png = await grabPosterFrame({ ffmpegPath: FFMPEG!, input: `http://127.0.0.1:${port}/test.mp4?sig=1`, timeoutMs: 30000 });
		expect(png.subarray(0, 4).toString('hex')).toBe('89504e47');
		expect(rangeRequests).toBeGreaterThan(0);
	});

	realIt('falls back to the first frame for clips shorter than 1 s', async () => {
		const png = await grabPosterFrame({ ffmpegPath: FFMPEG!, input: shortMp4, timeoutMs: 30000 });
		expect(png.length).toBeGreaterThan(100);
	});

	realIt('fails (does not hang) on a non-video file', async () => {
		const bad = join(dir, 'bad.mp4');
		await writeFile(bad, Buffer.from('this is not a video'));
		await expect(grabPosterFrame({ ffmpegPath: FFMPEG!, input: bad, timeoutMs: 30000 })).rejects.toThrow();
	});

	realIt('kills ffmpeg on timeout', async () => {
		await expect(extractFrame({ ffmpegPath: FFMPEG!, input: mp4, seekSec: 1, timeoutMs: 1 })).rejects.toThrow();
	});

	realIt('frame goes through the preset pipeline (resize/format)', async () => {
		const png = await grabPosterFrame({ ffmpegPath: FFMPEG!, input: mp4, timeoutMs: 30000 });
		const out = await processBufferWithPreset(png, { key: 'card', width: 400, height: 300, fit: 'cover', quality: 80 }, 'webp');
		const meta = await sharp(out.buffer).metadata();
		expect(meta.format).toBe('webp');
		expect(meta.width).toBe(400);
		expect(meta.height).toBe(300);

		const jpg = await processBufferWithPreset(png, { key: 'hero', width: 640 }, 'jpg');
		const m2 = await sharp(jpg.buffer).metadata();
		expect(m2.format).toBe('jpeg');
		expect(m2.width).toBe(640);
		expect(m2.height).toBe(360);

		// withoutEnlargement по умолчанию: не увеличиваем
		const big = await processBufferWithPreset(png, { key: 'x', width: 3000 }, 'png');
		expect((await sharp(big.buffer).metadata()).width).toBe(1280);
	});
});
