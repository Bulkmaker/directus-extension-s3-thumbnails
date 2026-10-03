import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createGunzip } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Работа с ffmpeg для видео-постеров.
 *
 * Бинарь ищется в порядке: THUMBNAILS_FFMPEG_PATH → пакет ffmpeg-static (если
 * рядом установлен) → ранее скачанный в кэш → `ffmpeg` из PATH → скачивание
 * статического бинаря (ffmpeg-static b6.1.1, проверка sha256, только linux
 * x64/arm64 и macOS arm64). Бинари статические — работают на alpine/musl.
 */

interface Logger {
	info: (msg: string) => void;
	warn: (msg: string) => void;
	error: (msg: string) => void;
}

export const FFMPEG_RELEASE = 'b6.1.1';
const FFMPEG_BASE_URL = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}`;

/** sha256 gz-архивов релиза ffmpeg-static b6.1.1 */
export const FFMPEG_GZ_SHA256: Record<string, string> = {
	'linux-x64': 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa',
	'linux-arm64': '754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0',
	'darwin-arm64': '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa',
};

export interface FfmpegOptions {
	ffmpegPath?: string;
	allowDownload: boolean;
	ffmpegDir?: string;
}

let resolvedPath: string | null = null;
let resolving: Promise<string> | null = null;

/** Для тестов */
export function resetFfmpegCache() {
	resolvedPath = null;
	resolving = null;
}

/** Бинарь запускается и печатает версию */
export function checkBinary(binary: string, timeoutMs = 10000): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const child = spawn(binary, ['-version'], { stdio: 'ignore' });
			const timer = setTimeout(() => {
				child.kill('SIGKILL');
				resolve(false);
			}, timeoutMs);
			child.on('error', () => {
				clearTimeout(timer);
				resolve(false);
			});
			child.on('close', (code) => {
				clearTimeout(timer);
				resolve(code === 0);
			});
		} catch {
			resolve(false);
		}
	});
}

function cacheBinaryPath(opts: FfmpegOptions): string {
	const dir = opts.ffmpegDir || join(tmpdir(), 'directus-s3-thumbnails-ffmpeg');
	return join(dir, `ffmpeg-${FFMPEG_RELEASE}-${process.platform}-${process.arch}`);
}

/**
 * Скачать и проверить статический ffmpeg. Бросает при несовпадении sha256.
 */
export async function downloadFfmpeg(
	opts: FfmpegOptions,
	logger: Logger,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const target = `${process.platform}-${process.arch}`;
	const expected = FFMPEG_GZ_SHA256[target];
	if (!expected) {
		throw new Error(`no pinned ffmpeg binary for ${target}; set THUMBNAILS_FFMPEG_PATH`);
	}

	const dest = cacheBinaryPath(opts);
	await mkdir(join(dest, '..'), { recursive: true });

	const url = `${FFMPEG_BASE_URL}/ffmpeg-${target}.gz`;
	logger.info(`[thumbnails] Downloading ffmpeg ${FFMPEG_RELEASE} (${target}) ...`);

	const response = await fetchImpl(url, { redirect: 'follow' });
	if (!response.ok || !response.body) {
		throw new Error(`ffmpeg download failed: HTTP ${response.status}`);
	}

	const hash = createHash('sha256');
	const tmpFile = `${dest}.${process.pid}.part`;
	const hasher = new Transform({
		transform(chunk, _enc, cb) {
			hash.update(chunk);
			cb(null, chunk);
		},
	});

	try {
		await pipeline(
			Readable.fromWeb(response.body as any),
			hasher,
			createGunzip(),
			createWriteStream(tmpFile)
		);
		const digest = hash.digest('hex');
		if (digest !== expected) {
			throw new Error(`ffmpeg checksum mismatch (got ${digest})`);
		}
		await chmod(tmpFile, 0o755);
		await rename(tmpFile, dest);
	} catch (e) {
		await rm(tmpFile, { force: true });
		throw e;
	}

	logger.info(`[thumbnails] ffmpeg saved to ${dest}`);
	return dest;
}

async function resolveUncached(opts: FfmpegOptions, logger: Logger): Promise<string> {
	// 1. явный путь
	if (opts.ffmpegPath) {
		if (await checkBinary(opts.ffmpegPath)) return opts.ffmpegPath;
		throw new Error(`THUMBNAILS_FFMPEG_PATH is not a working ffmpeg: ${opts.ffmpegPath}`);
	}

	// 2. ffmpeg-static, если установлен рядом
	try {
		const req = createRequire(import.meta.url);
		const p = req('ffmpeg-static') as string | null;
		if (p && (await checkBinary(p))) return p;
	} catch {
		/* не установлен */
	}

	// 3. кэш предыдущего скачивания
	const cached = cacheBinaryPath(opts);
	try {
		await stat(cached);
		if (await checkBinary(cached)) return cached;
	} catch {
		/* нет в кэше */
	}

	// 4. системный ffmpeg
	if (await checkBinary('ffmpeg')) return 'ffmpeg';

	// 5. скачивание
	if (!opts.allowDownload) {
		throw new Error('ffmpeg not found (set THUMBNAILS_FFMPEG_PATH or allow THUMBNAILS_FFMPEG_DOWNLOAD)');
	}
	const downloaded = await downloadFfmpeg(opts, logger);
	if (!(await checkBinary(downloaded))) {
		throw new Error(`downloaded ffmpeg does not run: ${downloaded}`);
	}
	return downloaded;
}

export async function resolveFfmpeg(opts: FfmpegOptions, logger: Logger): Promise<string> {
	if (resolvedPath) return resolvedPath;
	if (!resolving) {
		resolving = resolveUncached(opts, logger)
			.then((p) => {
				resolvedPath = p;
				return p;
			})
			.finally(() => {
				resolving = null;
			});
	}
	return resolving;
}

const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export interface ExtractFrameOptions {
	ffmpegPath: string;
	/** HTTP-URL (локальный Range-прокси) или локальный путь */
	input: string;
	/** секунда кадра */
	seekSec: number;
	timeoutMs: number;
}

/** Аргументы ffmpeg: один кадр в PNG на stdout */
export function buildFfmpegArgs(input: string, seekSec: number): string[] {
	const isUrl = /^https?:\/\//i.test(input);
	return [
		'-hide_banner',
		'-loglevel', 'error',
		'-nostdin',
		...(isUrl ? ['-protocol_whitelist', 'http,https,tcp,tls,crypto', '-rw_timeout', '20000000'] : []),
		'-ss', String(seekSec),
		'-i', input,
		'-frames:v', '1',
		'-an', '-sn', '-dn',
		// ограничиваем огромные исходники (8K); пресеты всё равно < 5000px
		'-vf', "scale='min(3840,iw)':-2",
		'-f', 'image2pipe',
		'-c:v', 'png',
		'pipe:1',
	];
}

/**
 * Снять один кадр. Пустой результат (нет кадра на этой секунде) -> ошибка
 * `NoFrameError`; таймаут -> ошибка с `timedOut`.
 */
export function extractFrame(opts: ExtractFrameOptions): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const child = spawn(opts.ffmpegPath, buildFfmpegArgs(opts.input, opts.seekSec), {
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		const out: Buffer[] = [];
		let outSize = 0;
		let stderr = '';
		let timedOut = false;
		let overflow = false;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
		}, opts.timeoutMs);

		child.stdout.on('data', (chunk: Buffer) => {
			outSize += chunk.length;
			if (outSize > MAX_FRAME_BYTES) {
				overflow = true;
				child.kill('SIGKILL');
				return;
			}
			out.push(chunk);
		});
		child.stderr.on('data', (chunk: Buffer) => {
			if (stderr.length < 2000) stderr += chunk.toString();
		});

		child.on('error', (err) => {
			clearTimeout(timer);
			reject(err);
		});

		child.on('close', (code) => {
			clearTimeout(timer);
			if (timedOut) {
				const e = new Error(`ffmpeg timed out after ${opts.timeoutMs} ms`);
				(e as any).timedOut = true;
				return reject(e);
			}
			if (overflow) return reject(new Error('ffmpeg frame output too large'));
			if (code !== 0) {
				return reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim().slice(0, 500)}`));
			}
			const buffer = Buffer.concat(out);
			if (buffer.length === 0) {
				const e = new Error('ffmpeg produced no frame');
				(e as any).noFrame = true;
				return reject(e);
			}
			resolve(buffer);
		});
	});
}

/**
 * Кадр на секунде 1; если там кадра нет (ролик короче секунды) — первый кадр.
 */
export async function grabPosterFrame(opts: Omit<ExtractFrameOptions, 'seekSec'>): Promise<Buffer> {
	try {
		return await extractFrame({ ...opts, seekSec: 1 });
	} catch (e) {
		if ((e as any)?.timedOut) throw e;
		return extractFrame({ ...opts, seekSec: 0 });
	}
}
