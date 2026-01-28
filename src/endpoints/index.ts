import { defineEndpoint } from '@directus/extensions-sdk';
import { registerRegenerateEndpoint } from './regenerate.js';
import { registerCleanupEndpoint } from './cleanup.js';

export default defineEndpoint((router, { database, env, logger, services, getSchema }) => {
	// Health check
	router.get('/', (_req, res) => {
		res.json({
			status: 'ok',
			extension: 'thumbnails-generator',
			version: '1.0.0',
		});
	});

	// S3 config for frontend (public data only, no credentials)
	router.get('/config', (_req, res) => {
		// Use FILES_DOMAIN if set, otherwise construct from S3 config
		const filesDomain = env['FILES_DOMAIN'];

		if (filesDomain) {
			res.json({
				baseUrl: `https://${filesDomain}`,
			});
		} else {
			const endpoint = env['STORAGE_S3_ENDPOINT'] || '';
			const bucket = env['STORAGE_S3_BUCKET'] || '';
			const root = env['STORAGE_S3_ROOT'] || '';
			const baseUrl = root
				? `${endpoint}/${bucket}/${root}`
				: `${endpoint}/${bucket}`;
			res.json({ baseUrl });
		}
	});

	// Create shared context for handlers
	const context = { database, env, logger, services, getSchema };

	// Register endpoints
	registerRegenerateEndpoint(router, context);
	registerCleanupEndpoint(router, env, logger);

	logger.info('[thumbnails] Endpoints registered: /thumbnails/regenerate, /thumbnails/cleanup');
});
