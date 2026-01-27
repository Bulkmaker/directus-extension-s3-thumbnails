import type { Router, Request, Response } from 'express';
import { getS3Config } from '../utils/config.js';
import { createS3Client, deleteS3Prefix } from '../services/s3.js';

interface Logger {
	info: (msg: string) => void;
	warn: (msg: string) => void;
	error: (msg: string) => void;
}

interface CleanupRequest {
	preset: string;
}

/**
 * Register cleanup endpoint
 */
export function registerCleanupEndpoint(
	router: Router,
	env: Record<string, string>,
	logger: Logger
) {
	router.delete('/cleanup', async (req: Request, res: Response) => {
		const { preset } = req.body as CleanupRequest;

		// Check admin permission
		const accountability = (req as Request & { accountability?: { admin?: boolean } }).accountability;
		if (!accountability?.admin) {
			return res.status(403).json({ error: 'Admin access required' });
		}

		if (!preset) {
			return res.status(400).json({ error: 'preset is required' });
		}

		try {
			const s3Config = getS3Config(env);
			const s3Client = createS3Client(s3Config);

			// Build prefix for the preset folder
			const prefix = s3Config.root ? `${s3Config.root}/${preset}/` : `${preset}/`;

			logger.info(`[thumbnails] Cleaning up preset: ${preset} (prefix: ${prefix})`);

			const deleted = await deleteS3Prefix(s3Client, s3Config.bucket, prefix);

			logger.info(`[thumbnails] Cleanup completed: deleted ${deleted} files from ${preset}/`);

			res.json({
				success: true,
				preset,
				deleted,
				message: `Deleted ${deleted} files from ${preset}/ folder`,
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`[thumbnails] Cleanup error: ${message}`);
			res.status(500).json({ error: message });
		}
	});
}
