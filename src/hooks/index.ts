import { defineHook } from '@directus/extensions-sdk';
import { createUploadHandler, createUpdateHandler, cacheOldFileData } from './on-upload.js';
import { createDeleteHandler } from './on-delete.js';
import { isImage } from '../utils/mime.js';

export default defineHook(({ filter, action }, { database, env, logger }) => {
	// Check if S3 storage is configured
	if (env['STORAGE_S3_DRIVER'] !== 's3') {
		logger.info('[thumbnails] S3 storage not configured, hook disabled');
		return;
	}

	logger.info('[thumbnails] Hook initialized');

	// Use files.upload for new file uploads
	// Add small delay to ensure file is accessible via /assets/
	action('files.upload', async (meta) => {
		const { payload, key } = meta as { payload: { type?: string; filename_disk?: string }; key: string };

		logger.info(`[thumbnails] files.upload triggered: key=${key}, type=${payload?.type}`);

		// Skip non-images
		if (!payload?.type || !isImage(payload.type)) {
			return;
		}

		// Wait for file to be fully available in DB
		await new Promise((resolve) => setTimeout(resolve, 500));

		// Call upload handler
		const handler = createUploadHandler(database, env, logger);
		await handler({ payload: { ...payload, id: key } as any, key, collection: 'directus_files' });
	});

	// Filter hook to capture old file data BEFORE database update
	filter('items.update', async (payload, meta) => {
		if (meta.collection !== 'directus_files') {
			return payload;
		}

		// Get file IDs being updated
		const keys = meta.keys as string[];

		for (const fileId of keys) {
			// Only cache if file content is changing (not just metadata)
			const p = payload as { filename_disk?: string; type?: string };
			if (!p.filename_disk && !p.type) {
				continue;
			}

			// Read OLD data from database (before update happens)
			const oldFile = await database('directus_files')
				.where('id', fileId)
				.select('filename_disk', 'type')
				.first();

			if (oldFile && isImage(oldFile.type)) {
				// Check if file content actually changed
				const isFileChanged =
					(p.filename_disk && p.filename_disk !== oldFile.filename_disk) ||
					(p.type && p.type !== oldFile.type);

				if (isFileChanged) {
					// Cache old data for action hook
					cacheOldFileData(fileId, {
						filename_disk: oldFile.filename_disk,
						type: oldFile.type,
					});
				}
			}
		}

		// Always return payload to allow update to proceed
		return payload;
	});

	// Use items.update on directus_files (file replaced)
	action('items.update', createUpdateHandler(database, env, logger));

	// Use items.delete on directus_files (cleanup thumbnails)
	action('items.delete', createDeleteHandler(database, env, logger));
});
