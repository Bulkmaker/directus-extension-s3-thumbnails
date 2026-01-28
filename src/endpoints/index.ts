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

	// Create shared context for handlers
	const context = { database, env, logger, services, getSchema };

	// Register endpoints
	registerRegenerateEndpoint(router, context);
	registerCleanupEndpoint(router, env, logger);

	logger.info('[thumbnails] Endpoints registered: /thumbnails/regenerate, /thumbnails/cleanup');
});
