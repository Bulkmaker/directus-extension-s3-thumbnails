import { defineEndpoint } from '@directus/extensions-sdk';
import { registerRegenerateEndpoint } from './regenerate.js';
import { registerCleanupEndpoint } from './cleanup.js';
import { loadConfig, getS3Config, getPresetFormat } from '../utils/config.js';
import { createS3Client, countS3Objects } from '../services/s3.js';

export default defineEndpoint((router, { database, env, logger, services, getSchema }) => {
	// Health check
	router.get('/', (_req, res) => {
		res.json({
			status: 'ok',
			extension: 'thumbnails-generator',
			version: '1.0.0',
		});
	});

	// Stats: count thumbnails per preset from S3
	router.get('/stats', async (req, res) => {
		// Check admin permission
		const accountability = (req as any).accountability;
		if (!accountability?.admin) {
			return res.status(403).json({ error: 'Admin access required' });
		}

		try {
			const config = await loadConfig(database, env);
			const s3Config = getS3Config(env);
			const s3Client = createS3Client(s3Config);

			// Count images in DB
			const imageCountResult = await database('directus_files')
				.where('type', 'like', 'image/%')
				.count('* as count')
				.first();
			const totalImages = Number(imageCountResult?.count ?? 0);

			// Count thumbnails per preset on S3
			const presetStats = await Promise.all(
				config.presets.map(async (preset) => {
					const prefix = s3Config.root
						? `${s3Config.root}/${preset.key}/`
						: `${preset.key}/`;
					const count = await countS3Objects(s3Client, s3Config.bucket, prefix);
					const format = getPresetFormat(preset);

					return {
						key: preset.key,
						width: preset.width,
						height: preset.height,
						format,
						count,
						expected: totalImages,
						missing: Math.max(0, totalImages - count),
					};
				})
			);

			const totalThumbnails = presetStats.reduce((sum, p) => sum + p.count, 0);
			const totalExpected = totalImages * config.presets.length;

			res.json({
				totalImages,
				totalPresets: config.presets.length,
				totalThumbnails,
				totalExpected,
				totalMissing: Math.max(0, totalExpected - totalThumbnails),
				presets: presetStats,
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`[thumbnails] Stats error: ${message}`);
			res.status(500).json({ error: message });
		}
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
	registerCleanupEndpoint(router, env, logger, database);

	logger.info('[thumbnails] Endpoints registered: /thumbnails/regenerate, /thumbnails/cleanup, /thumbnails/cleanup/orphans');
});
