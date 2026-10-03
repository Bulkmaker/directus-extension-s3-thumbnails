import type { Knex } from 'knex';
import { loadConfig, getS3Config } from '../utils/config.js';
import { isImage, isVideo, getBasename, buildThumbnailKey } from '../utils/mime.js';
import { createS3Client, listS3Objects, deleteFromS3 } from '../services/s3.js';

interface DeletedFile {
	id?: string;
	filename_disk?: string;
	type?: string | null;
	[key: string]: unknown;
}

interface Logger {
	info: (msg: string) => void;
	warn: (msg: string) => void;
	error: (msg: string) => void;
}

// Данные удаляемых файлов между filter (до удаления) и action (после).
const pendingDeletes = new Map<string, { filename_disk: string; type: string | null }>();
const MAX_PENDING = 2000;

/**
 * Filter `files.delete`: строка файла ещё в БД — запоминаем filename_disk и type.
 * Всегда возвращает keys без изменений.
 */
export function createDeletePrefetch(database: Knex) {
	return async (keys: unknown) => {
		try {
			const ids = (Array.isArray(keys) ? keys : [keys]).filter(
				(k): k is string | number => typeof k === 'string' || typeof k === 'number'
			);
			if (ids.length > 0) {
				const rows = await database('directus_files')
					.whereIn('id', ids as string[])
					.select('id', 'filename_disk', 'type');
				for (const row of rows) {
					if (pendingDeletes.size >= MAX_PENDING) {
						const oldest = pendingDeletes.keys().next().value;
						if (oldest !== undefined) pendingDeletes.delete(oldest);
					}
					pendingDeletes.set(String(row.id), {
						filename_disk: row.filename_disk,
						type: row.type,
					});
				}
			}
		} catch {
			// Не мешаем удалению файла
		}
		return keys;
	};
}

/**
 * Какие файлы надо чистить: из кэша filter-хука по keys; либо (legacy) объекты
 * с filename_disk прямо в payload.
 */
export function collectDeletedFiles(
	payload: unknown,
	keys: unknown
): Array<{ filename_disk: string; type: string | null | undefined }> {
	const result: Array<{ filename_disk: string; type: string | null | undefined }> = [];

	for (const key of Array.isArray(keys) ? keys : []) {
		const cached = pendingDeletes.get(String(key));
		if (cached) {
			pendingDeletes.delete(String(key));
			result.push(cached);
		}
	}

	if (Array.isArray(payload)) {
		for (const item of payload as DeletedFile[]) {
			if (item && typeof item === 'object' && item.filename_disk) {
				result.push({ filename_disk: item.filename_disk, type: item.type });
			}
		}
	}

	return result;
}

/**
 * Create delete handler (action files.delete / items.delete на directus_files).
 * Удаляются варианты картинок и видео-постеров: чистка безопасна — трогает
 * только существующие объекты `<preset>/<basename>.*`.
 */
export function createDeleteHandler(database: Knex, env: Record<string, string>, logger: Logger) {
	return async ({ payload, keys, collection }: Record<string, any>) => {
		try {
			// Only handle directus_files collection (files.delete: collection всегда directus_files)
			if (collection && collection !== 'directus_files') {
				return;
			}

			const files = collectDeletedFiles(payload, keys);
			if (files.length === 0) {
				return;
			}

			const config = await loadConfig(database, env);
			const s3Config = getS3Config(env);
			const s3Client = createS3Client(s3Config);

			for (const file of files) {
				// Картинки и видео (варианты видео — постеры; если опция выключена, просто ничего не найдём)
				if (!isImage(file.type) && !isVideo(file.type)) {
					continue;
				}

				const basename = getBasename(file.filename_disk);
				let deletedCount = 0;

				// Delete thumbnails for each preset
				for (const preset of config.presets) {
					// e.g., "card/abc123." (с точкой, чтобы не зацепить abc1234)
					const prefix = buildThumbnailKey(s3Config.root, preset.key, basename, '');

					// List and delete all matching thumbnails
					const objectKeys = await listS3Objects(s3Client, s3Config.bucket, prefix);

					for (const key of objectKeys) {
						await deleteFromS3(s3Client, s3Config.bucket, key);
						deletedCount++;

						if (config.verbose) {
							logger.info(`[thumbnails] Deleted: ${key}`);
						}
					}
				}

				if (deletedCount > 0) {
					logger.info(`[thumbnails] Deleted ${deletedCount} thumbnails for: ${file.filename_disk}`);
				}
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`[thumbnails] Delete handler error: ${message}`);
		}
	};
}
