import type { Knex } from 'knex';
import { loadConfig, getS3Config } from '../utils/config.js';
import { isImage, getBasename, buildThumbnailKey } from '../utils/mime.js';
import { createS3Client, listS3Objects, deleteFromS3 } from '../services/s3.js';

interface DeletedFile {
	id: string;
	filename_disk: string;
	type: string;
	[key: string]: unknown;
}

interface Logger {
	info: (msg: string) => void;
	warn: (msg: string) => void;
	error: (msg: string) => void;
}

/**
 * Create delete handler for items.delete on directus_files
 */
export function createDeleteHandler(database: Knex, env: Record<string, string>, logger: Logger) {
	return async ({ payload, keys, collection }: { payload: DeletedFile[]; keys: string[]; collection: string }) => {
		try {
			// Only handle directus_files collection
			if (collection !== 'directus_files') {
				return;
			}

			if (!payload || !Array.isArray(payload)) {
				return;
			}

			const config = await loadConfig(database, env);
			const s3Config = getS3Config(env);
			const s3Client = createS3Client(s3Config);

			for (const file of payload) {
				// Skip non-images
				if (!isImage(file.type)) {
					continue;
				}

				const basename = getBasename(file.filename_disk);
				let deletedCount = 0;

				// Delete thumbnails for each preset
				for (const preset of config.presets) {
					// Build prefix for this file's thumbnails in this preset
					// e.g., "card/abc123" (without extension to match all formats)
					const prefix = buildThumbnailKey(s3Config.root, preset.key, basename, '');

					// List and delete all matching thumbnails
					const keys = await listS3Objects(s3Client, s3Config.bucket, prefix);

					for (const key of keys) {
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
