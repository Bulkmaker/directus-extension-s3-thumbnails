import type { Knex } from 'knex';
import { loadConfig, getS3Config, getPresetFormat, getNormalizedPresetConfig, computePresetConfigHash, type ThumbnailPreset } from '../utils/config.js';
import { isImage, getMimeType, getBasename, buildThumbnailKey } from '../utils/mime.js';
import { createS3Client, uploadToS3, existsInS3, withRetry, deleteS3Prefix, savePresetConfig, loadPresetConfig, type StoredPresetConfig } from '../services/s3.js';
import { generateThumbnail } from '../services/thumbnail.js';

// Track which presets have had their config saved in this session
const presetConfigSaved = new Set<string>();

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

interface HookContext {
	database: Knex;
	env: Record<string, string>;
	logger: Logger;
	services: any;
	getSchema: () => Promise<any>;
}

/**
 * Generate thumbnails for a single file using Directus AssetsService
 */
export async function generateThumbnailsForFile(
	file: FilePayload,
	context: HookContext,
	options: { force?: boolean; presets?: ThumbnailPreset[] } = {}
): Promise<{ generated: number; skipped: number }> {
	const { database, env, logger, services, getSchema } = context;
	const config = await loadConfig(database, env);
	const s3Config = getS3Config(env);
	const s3Client = createS3Client(s3Config);
	const schema = await getSchema();

	const basename = getBasename(file.filename_disk);

	let generated = 0;
	let skipped = 0;

	// Use provided presets or all presets from config
	const presetsToProcess = options.presets || config.presets;

	// Generate thumbnails for each preset using Directus AssetsService
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

		try {
			// Generate thumbnail via Directus AssetsService (internal API)
			const thumbnail = await generateThumbnail(
				file.id,
				preset,
				format as 'webp' | 'jpg' | 'png' | 'avif',
				services,
				schema
			);

			// Upload to S3
			await uploadToS3(s3Client, s3Config.bucket, thumbnailKey, thumbnail.buffer, getMimeType(format));

			generated++;
			if (config.verbose) {
				logger.info(`[thumbnails] Generated: ${thumbnailKey} (${thumbnail.width}x${thumbnail.height})`);
			}

			// Save preset config to S3 (once per preset per session)
			const presetCacheKey = `${s3Config.bucket}:${preset.key}`;
			if (!presetConfigSaved.has(presetCacheKey)) {
				try {
					const normalizedConfig = getNormalizedPresetConfig(preset);
					const hash = computePresetConfigHash(preset);
					const storedConfig: StoredPresetConfig = {
						hash,
						config: normalizedConfig,
						updatedAt: new Date().toISOString(),
					};
					await savePresetConfig(s3Client, s3Config.bucket, s3Config.root, preset.key, storedConfig);
					presetConfigSaved.add(presetCacheKey);
					if (config.verbose) {
						logger.info(`[thumbnails] Saved preset config: ${preset.key} (hash: ${hash})`);
					}
				} catch (configError) {
					// Non-critical error - just log and continue
					const msg = configError instanceof Error ? configError.message : String(configError);
					logger.warn(`[thumbnails] Failed to save preset config for ${preset.key}: ${msg}`);
				}
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`[thumbnails] Failed to generate ${thumbnailKey}: ${message}`);
		}
	}

	return { generated, skipped };
}

/**
 * Create upload handler for files.upload hook
 */
export function createUploadHandler(context: HookContext) {
	const { database, env, logger } = context;

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

			const result = await withRetry(() => generateThumbnailsForFile(file, context));

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
export function createUpdateHandler(context: HookContext) {
	const { database, env, logger } = context;

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
				const result = await withRetry(() => generateThumbnailsForFile(newFile, context));

				logger.info(`[thumbnails] Updated: ${newFile.filename_disk} (generated: ${result.generated})`);
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`[thumbnails] Update handler error: ${message}`);
		}
	};
}
