import type { Knex } from 'knex';
import { loadConfig, getS3Config, getPresetFormat, type ThumbnailPreset } from '../utils/config.js';
import { isImage, getMimeType, getBasename, buildThumbnailKey } from '../utils/mime.js';
import { createS3Client, uploadToS3, existsInS3, withRetry, deleteS3Prefix } from '../services/s3.js';
import { generateThumbnail } from '../services/thumbnail.js';

// Cache for old file data between filter and action hooks
// Key: fileId, Value: { filename_disk, type }
const oldFileDataCache = new Map<string, { filename_disk: string; type: string }>();

/**
 * Store old file data for later use in action hook
 */
export function cacheOldFileData(fileId: string, data: { filename_disk: string; type: string }) {
	oldFileDataCache.set(fileId, data);
}

/**
 * Get and remove old file data from cache
 */
export function popOldFileData(fileId: string): { filename_disk: string; type: string } | undefined {
	const data = oldFileDataCache.get(fileId);
	if (data) {
		oldFileDataCache.delete(fileId);
	}
	return data;
}

interface FilePayload {
	id: string;
	filename_disk: string;
	filename_download: string;
	type: string;
	[key: string]: unknown;
}

interface Logger {
	info: (msg: string) => void;
	warn: (msg: string) => void;
	error: (msg: string) => void;
}

/**
 * Generate thumbnails for a single file using Directus Transform API
 */
export async function generateThumbnailsForFile(
	file: FilePayload,
	database: Knex,
	env: Record<string, string>,
	logger: Logger,
	options: { force?: boolean; presets?: ThumbnailPreset[] } = {}
): Promise<{ generated: number; skipped: number }> {
	const config = await loadConfig(database, env);
	const s3Config = getS3Config(env);
	const s3Client = createS3Client(s3Config);

	const basename = getBasename(file.filename_disk);

	let generated = 0;
	let skipped = 0;

	// Use provided presets or all presets from config
	const presetsToProcess = options.presets || config.presets;

	// Generate thumbnails for each preset using Directus Transform API
	// Format comes from preset.format (set in Directus Settings)
	for (const preset of presetsToProcess) {
		const format = getPresetFormat(preset);
		const thumbnailKey = buildThumbnailKey(s3Config.root, preset.key, basename, format);

		// Skip if already exists (unless force=true)
		if (!options.force && (await existsInS3(s3Client, s3Config.bucket, thumbnailKey))) {
			skipped++;
			if (config.verbose) {
				logger.info(`[thumbnails] Skipped (exists): ${thumbnailKey}`);
			}
			continue;
		}

		// Generate thumbnail via Directus Transform API (uses built-in sharp)
		const thumbnail = await generateThumbnail(
			file.id,
			preset,
			format as 'webp' | 'jpg' | 'png' | 'avif',
			env
		);

		// Upload to S3
		await uploadToS3(s3Client, s3Config.bucket, thumbnailKey, thumbnail.buffer, getMimeType(format));

		generated++;
		if (config.verbose) {
			logger.info(`[thumbnails] Generated: ${thumbnailKey} (${thumbnail.width}x${thumbnail.height})`);
		}
	}

	return { generated, skipped };
}

/**
 * Create upload handler for files.upload hook
 */
export function createUploadHandler(database: Knex, env: Record<string, string>, logger: Logger) {
	return async ({ payload, key, collection }: { payload: FilePayload; key: string; collection: string }) => {
		try {
			// Only handle directus_files collection
			if (collection !== 'directus_files') {
				return;
			}

			// Skip non-images
			if (!isImage(payload.type)) {
				return;
			}

			const config = await loadConfig(database, env);
			if (config.presets.length === 0) {
				if (config.verbose) {
					logger.info('[thumbnails] No presets configured, skipping');
				}
				return;
			}

			logger.info(`[thumbnails] Processing upload: ${payload.filename_disk}`);

			// Use key as id (items.create provides the created record's key)
			const file = { ...payload, id: key };

			const result = await withRetry(() =>
				generateThumbnailsForFile(file, database, env, logger)
			);

			logger.info(
				`[thumbnails] Completed: ${payload.filename_disk} (generated: ${result.generated}, skipped: ${result.skipped})`
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`[thumbnails] Upload handler error: ${message}`);
		}
	};
}

/**
 * Create update handler for items.update on directus_files
 * Only regenerates if the actual file changed (not just metadata)
 *
 * NOTE: This handler runs AFTER the database update. Old file data
 * must be captured in the filter hook and stored via cacheOldFileData()
 */
export function createUpdateHandler(database: Knex, env: Record<string, string>, logger: Logger) {
	return async ({ payload, keys, collection }: { payload: Partial<FilePayload>; keys: string[]; collection: string }) => {
		try {
			// Only handle directus_files collection
			if (collection !== 'directus_files') {
				return;
			}

			for (const fileId of keys) {
				// Get old file data from cache (captured in filter hook)
				const oldFileData = popOldFileData(fileId);

				if (!oldFileData) {
					// No cached data means filter hook didn't detect a file change
					continue;
				}

				// Get current (new) file data from DB
				const newFile = await database('directus_files').where('id', fileId).first();

				if (!newFile || !isImage(newFile.type)) {
					continue;
				}

				const config = await loadConfig(database, env);
				const s3Config = getS3Config(env);
				const s3Client = createS3Client(s3Config);

				// Delete old thumbnails using OLD filename
				const oldBasename = getBasename(oldFileData.filename_disk);
				for (const preset of config.presets) {
					const prefix = buildThumbnailKey(s3Config.root, preset.key, oldBasename, '');
					await deleteS3Prefix(s3Client, s3Config.bucket, prefix);
				}

				logger.info(`[thumbnails] Deleted old thumbnails for: ${oldFileData.filename_disk}`);

				// Generate new thumbnails with new file data
				const result = await withRetry(() =>
					generateThumbnailsForFile(newFile, database, env, logger)
				);

				logger.info(
					`[thumbnails] Updated: ${newFile.filename_disk} (generated: ${result.generated})`
				);
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`[thumbnails] Update handler error: ${message}`);
		}
	};
}
