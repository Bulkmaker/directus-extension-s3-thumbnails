import type { Knex } from 'knex';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	loadConfig,
	getS3Config,
	getPresetFormat,
	getVideoConfig,
	type ThumbnailPreset,
} from '../utils/config.js';
import { getMimeType, getBasename, buildThumbnailKey, buildOriginalKey } from '../utils/mime.js';
import {
	createS3Client,
	uploadToS3,
	existsInS3,
	getObjectMetadata,
	downloadToFile,
} from './s3.js';
import { resolveFfmpeg, grabPosterFrame } from './ffmpeg.js';
import { startRangeProxy } from './range-proxy.js';
import { processBufferWithPreset } from './image-pipeline.js';
import { ensurePresetConfigSaved } from './preset-sync.js';

interface Logger {
	info: (msg: string) => void;
	warn: (msg: string) => void;
	error: (msg: string) => void;
}

export interface VideoFile {
	id: string;
	filename_disk: string;
	filename_download?: string;
	type: string;
	[key: string]: unknown;
}

export interface VideoContext {
	database: Knex;
	env: Record<string, string>;
	logger: Logger;
}

export interface PosterResult {
	generated: number;
	skipped: number;
	errors: number;
}

// Не больше N ffmpeg одновременно (массовая регенерация / пачка загрузок)
const MAX_CONCURRENT = 2;
let active = 0;
const waiters: Array<() => void> = [];

async function acquire() {
	if (active < MAX_CONCURRENT) {
		active++;
		return;
	}
	await new Promise<void>((resolve) => waiters.push(resolve));
}

function release() {
	const next = waiters.shift();
	if (next) next();
	else active--;
}

/**
 * Постеры видео: один кадр ffmpeg -> те же пресеты и те же ключи S3, что у
 * миниатюр картинок: `<preset.key>/<basename>.<format>`.
 *
 * Любая ошибка (ffmpeg, sharp, S3) логируется и возвращается как errors > 0;
 * функция НЕ бросает — загрузка файла не страдает.
 */
export async function generateVideoPostersForFile(
	file: VideoFile,
	context: VideoContext,
	options: { force?: boolean; presets?: ThumbnailPreset[] } = {}
): Promise<PosterResult> {
	const { database, env, logger } = context;
	const result: PosterResult = { generated: 0, skipped: 0, errors: 0 };

	const video = getVideoConfig(env);
	if (!video.enabled) return result;

	try {
		const config = await loadConfig(database, env);
		const presets = options.presets || config.presets;
		if (presets.length === 0) return result;

		const s3Config = getS3Config(env);
		const s3Client = createS3Client(s3Config);
		const basename = getBasename(file.filename_disk);

		// Какие варианты ещё нужны
		const pending: Array<{ preset: ThumbnailPreset; format: string; key: string }> = [];
		for (const preset of presets) {
			const format = getPresetFormat(preset);
			const key = buildThumbnailKey(s3Config.root, preset.key, basename, format);
			if (!options.force && (await existsInS3(s3Client, s3Config.bucket, key))) {
				result.skipped++;
				continue;
			}
			pending.push({ preset, format, key });
		}
		if (pending.length === 0) return result;

		const originalKey = buildOriginalKey(s3Config.root, file.filename_disk);

		// Лимит размера
		const meta = await getObjectMetadata(s3Client, s3Config.bucket, originalKey);
		if (!meta) {
			logger.warn(`[thumbnails] Video poster skipped (original not found in S3): ${originalKey}`);
			result.errors++;
			return result;
		}
		if (meta.size > video.maxBytes) {
			logger.warn(
				`[thumbnails] Video poster skipped (size ${Math.round(meta.size / 1048576)} MB > THUMBNAILS_VIDEO_MAX_MB): ${file.filename_disk}`
			);
			return result;
		}

		await acquire();
		let frame: Buffer;
		try {
			const ffmpegPath = await resolveFfmpeg(video, logger);
			frame = await grabFrameWithFallback({
				ffmpegPath,
				s3Client,
				bucket: s3Config.bucket,
				key: originalKey,
				size: meta.size,
				video,
				logger,
			});
		} finally {
			release();
		}

		for (const { preset, format, key } of pending) {
			try {
				const out = await processBufferWithPreset(frame, preset, format);
				await uploadToS3(s3Client, s3Config.bucket, key, out.buffer, getMimeType(format));
				result.generated++;
				if (config.verbose) {
					logger.info(`[thumbnails] Video poster: ${key} (${out.width}x${out.height})`);
				}
				await ensurePresetConfigSaved(
					s3Client,
					s3Config.bucket,
					s3Config.root,
					preset,
					logger,
					config.verbose
				);
			} catch (e) {
				result.errors++;
				logger.error(`[thumbnails] Failed to generate video poster ${key}: ${errMsg(e)}`);
			}
		}
	} catch (e) {
		result.errors++;
		logger.error(`[thumbnails] Video poster failed for ${file.filename_disk}: ${errMsg(e)}`);
	}

	return result;
}

function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/**
 * Основной путь: ffmpeg читает видео через локальный Range-прокси к S3
 * (скачиваются только нужные куски, без полной загрузки файла). Если не
 * вышло — запасной путь: временный файл (лимит размера, обязательная очистка).
 */
async function grabFrameWithFallback(args: {
	ffmpegPath: string;
	s3Client: ReturnType<typeof createS3Client>;
	bucket: string;
	key: string;
	size: number;
	video: ReturnType<typeof getVideoConfig>;
	logger: Logger;
}): Promise<Buffer> {
	const { ffmpegPath, s3Client, bucket, key, size, video, logger } = args;

	try {
		const proxy = await startRangeProxy(s3Client, bucket, key, size);
		try {
			return await grabPosterFrame({ ffmpegPath, input: proxy.url, timeoutMs: video.timeoutMs });
		} finally {
			await proxy.close();
		}
	} catch (e) {
		if ((e as any)?.timedOut) throw e;
		logger.warn(`[thumbnails] ffmpeg streaming from S3 failed (${errMsg(e)}), falling back to temp file`);
	}

	const dir = await mkdtemp(join(tmpdir(), 'ngs-poster-'));
	try {
		const filePath = join(dir, 'source');
		await downloadToFile(s3Client, bucket, key, filePath, video.maxBytes);
		return await grabPosterFrame({ ffmpegPath, input: filePath, timeoutMs: video.timeoutMs });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
