import { defineHook } from '@directus/extensions-sdk';
import { createUploadHandler, createUpdateHandler, cacheOldFileData } from './on-upload.js';
import { createDeleteHandler, createDeletePrefetch } from './on-delete.js';
import { isThumbnailSource } from '../utils/mime.js';
import { getVideoConfig } from '../utils/config.js';

export default defineHook(({ filter, action }, { database, env, logger, services, getSchema }) => {
	// Check if S3 storage is configured
	if (env['STORAGE_S3_DRIVER'] !== 's3') {
		logger.info('[thumbnails] S3 storage not configured, hook disabled');
		return;
	}

	const videoPosters = getVideoConfig(env).enabled;
	logger.info(`[thumbnails] Hook initialized (video posters: ${videoPosters ? 'on' : 'off'})`);

	// Create shared context for all handlers
	const context = { database, env, logger, services, getSchema };

	// Use files.upload for new file uploads
	action('files.upload', async (meta) => {
		const { payload, key } = meta as { payload: { type?: string; filename_disk?: string }; key: string };

		logger.info(`[thumbnails] files.upload triggered: key=${key}, type=${payload?.type}`);

		// Skip всё, кроме картинок (и видео при THUMBNAILS_VIDEO_POSTERS=true)
		if (!payload?.type || !isThumbnailSource(payload.type, videoPosters)) {
			return;
		}

		// Call upload handler (no delay needed - we use internal API now)
		const handler = createUploadHandler(context);
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

			if (oldFile && isThumbnailSource(oldFile.type, videoPosters)) {
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
	action('items.update', createUpdateHandler(context));

	// Удаление файла: для системной коллекции directus_files Directus шлёт события
	// `files.delete` (а не `items.delete`). Filter срабатывает ДО удаления строки и
	// запоминает filename_disk/type, action после удаления чистит миниатюры в S3.
	filter('files.delete', createDeletePrefetch(database));

	const deleteHandler = createDeleteHandler(database, env, logger);
	action('files.delete', deleteHandler);
	// legacy-событие оставлено для обратной совместимости
	action('items.delete', deleteHandler);
});
