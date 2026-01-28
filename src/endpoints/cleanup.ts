import type { Router, Request, Response } from 'express';
import type { Knex } from 'knex';
import { getS3Config, loadConfig } from '../utils/config.js';
import { createS3Client, deleteS3Prefix, listS3Folders, countS3Objects } from '../services/s3.js';

interface Logger {
	info: (msg: string) => void;
	warn: (msg: string) => void;
	error: (msg: string) => void;
}

interface CleanupRequest {
	preset: string;
	sse?: boolean;
}

interface CleanupJobState {
	id: string;
	status: 'running' | 'completed' | 'cancelled' | 'error';
	preset: string;
	deleted: number;
	total: number;
	percent: number;
	error?: string;
}

// Global cleanup job state
let cleanupJob: CleanupJobState | null = null;
let cleanupAbortController: AbortController | null = null;

/**
 * Register cleanup endpoint
 */
export function registerCleanupEndpoint(
	router: Router,
	env: Record<string, string>,
	logger: Logger,
	database: Knex
) {
	// DELETE /cleanup — start cleanup job
	router.delete('/cleanup', async (req: Request, res: Response) => {
		const { preset, sse } = req.body as CleanupRequest;

		// Check admin permission
		const accountability = (req as Request & { accountability?: { admin?: boolean } }).accountability;
		if (!accountability?.admin) {
			return res.status(403).json({ error: 'Admin access required' });
		}

		if (!preset) {
			return res.status(400).json({ error: 'preset is required' });
		}

		// Check if cleanup already running
		if (cleanupJob?.status === 'running') {
			return res.status(409).json({
				error: 'Cleanup already running',
				preset: cleanupJob.preset,
			});
		}

		const jobId = `cleanup-${Date.now()}`;
		cleanupJob = {
			id: jobId,
			status: 'running',
			preset,
			deleted: 0,
			total: 0,
			percent: 0,
		};

		cleanupAbortController = new AbortController();

		// If SSE requested, stream progress
		if (sse) {
			res.setHeader('Content-Type', 'text/event-stream');
			res.setHeader('Cache-Control', 'no-cache');
			res.setHeader('Connection', 'keep-alive');
			res.flushHeaders();

			// Send initial state
			res.write(`data: ${JSON.stringify(cleanupJob)}\n\n`);

			// Start cleanup in background
			runCleanup(env, logger, (progress) => {
				if (cleanupJob) {
					cleanupJob.deleted = progress.deleted;
					cleanupJob.total = progress.total;
					cleanupJob.percent = progress.percent;
					res.write(`data: ${JSON.stringify(cleanupJob)}\n\n`);
				}
			})
				.then(() => {
					if (cleanupJob && cleanupJob.status === 'running') {
						cleanupJob.status = 'completed';
						res.write(`data: ${JSON.stringify(cleanupJob)}\n\n`);
					}
					res.end();
				})
				.catch((err) => {
					if (cleanupJob) {
						cleanupJob.status = 'error';
						cleanupJob.error = err.message;
						res.write(`data: ${JSON.stringify(cleanupJob)}\n\n`);
					}
					res.end();
				});
		} else {
			// Synchronous mode — wait for completion
			try {
				const s3Config = getS3Config(env);
				const s3Client = createS3Client(s3Config);
				const prefix = s3Config.root ? `${s3Config.root}/${preset}/` : `${preset}/`;

				logger.info(`[thumbnails] Cleaning up preset: ${preset} (prefix: ${prefix})`);

				const deleted = await deleteS3Prefix(s3Client, s3Config.bucket, prefix);

				cleanupJob.status = 'completed';
				cleanupJob.deleted = deleted;
				cleanupJob.percent = 100;

				logger.info(`[thumbnails] Cleanup completed: deleted ${deleted} files from ${preset}/`);

				res.json({
					success: true,
					preset,
					deleted,
					message: `Deleted ${deleted} files from ${preset}/ folder`,
				});
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				cleanupJob.status = 'error';
				cleanupJob.error = message;
				logger.error(`[thumbnails] Cleanup error: ${message}`);
				res.status(500).json({ error: message });
			}
		}
	});

	// GET /cleanup/status — get cleanup job status
	router.get('/cleanup/status', (req: Request, res: Response) => {
		// Check admin permission
		const accountability = (req as Request & { accountability?: { admin?: boolean } }).accountability;
		if (!accountability?.admin) {
			return res.status(403).json({ error: 'Admin access required' });
		}

		if (!cleanupJob) {
			return res.json({ status: 'idle' });
		}

		res.json(cleanupJob);
	});

	// POST /cleanup/cancel — cancel running cleanup
	router.post('/cleanup/cancel', (req: Request, res: Response) => {
		// Check admin permission
		const accountability = (req as Request & { accountability?: { admin?: boolean } }).accountability;
		if (!accountability?.admin) {
			return res.status(403).json({ error: 'Admin access required' });
		}

		if (!cleanupJob || cleanupJob.status !== 'running') {
			return res.json({ cancelled: false, reason: 'No running cleanup' });
		}

		if (cleanupAbortController) {
			cleanupAbortController.abort();
		}

		cleanupJob.status = 'cancelled';
		logger.info(`[thumbnails] Cleanup cancelled`);

		res.json({ cancelled: true });
	});

	// GET /cleanup/orphans — find folders on S3 that don't match any preset
	router.get('/cleanup/orphans', async (req: Request, res: Response) => {
		// Check admin permission
		const accountability = (req as Request & { accountability?: { admin?: boolean } }).accountability;
		if (!accountability?.admin) {
			return res.status(403).json({ error: 'Admin access required' });
		}

		try {
			// Get current presets
			const config = await loadConfig(database, env);
			const presetKeys = new Set(config.presets.map((p) => p.key));

			// Get folders from S3
			const s3Config = getS3Config(env);
			const s3Client = createS3Client(s3Config);
			const s3Folders = await listS3Folders(s3Client, s3Config.bucket, s3Config.root || '');

			// Find orphans (folders that don't match any preset)
			const orphans: Array<{ folder: string; count: number }> = [];

			for (const folder of s3Folders) {
				if (!presetKeys.has(folder)) {
					// Count files in orphan folder
					const prefix = s3Config.root ? `${s3Config.root}/${folder}/` : `${folder}/`;
					const count = await countS3Objects(s3Client, s3Config.bucket, prefix);
					orphans.push({ folder, count });
				}
			}

			logger.info(`[thumbnails] Found ${orphans.length} orphan folders on S3`);

			res.json({
				presets: Array.from(presetKeys),
				s3Folders,
				orphans,
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`[thumbnails] Orphan scan error: ${message}`);
			res.status(500).json({ error: message });
		}
	});

	// DELETE /cleanup/orphan/:folder — delete specific orphan folder
	router.delete('/cleanup/orphan/:folder', async (req: Request, res: Response) => {
		const { folder } = req.params;

		// Check admin permission
		const accountability = (req as Request & { accountability?: { admin?: boolean } }).accountability;
		if (!accountability?.admin) {
			return res.status(403).json({ error: 'Admin access required' });
		}

		if (!folder) {
			return res.status(400).json({ error: 'folder is required' });
		}

		// Safety check: make sure it's not a current preset
		const config = await loadConfig(database, env);
		const presetKeys = new Set(config.presets.map((p) => p.key));

		if (presetKeys.has(folder)) {
			return res.status(400).json({
				error: `"${folder}" is a current preset, not an orphan`,
			});
		}

		try {
			const s3Config = getS3Config(env);
			const s3Client = createS3Client(s3Config);
			const prefix = s3Config.root ? `${s3Config.root}/${folder}/` : `${folder}/`;

			logger.info(`[thumbnails] Deleting orphan folder: ${folder} (prefix: ${prefix})`);

			const deleted = await deleteS3Prefix(s3Client, s3Config.bucket, prefix);

			logger.info(`[thumbnails] Orphan cleanup completed: deleted ${deleted} files from ${folder}/`);

			res.json({
				success: true,
				folder,
				deleted,
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error(`[thumbnails] Orphan delete error: ${message}`);
			res.status(500).json({ error: message });
		}
	});

	// Helper function to run cleanup
	async function runCleanup(
		envConfig: Record<string, string>,
		log: Logger,
		onProgress: (p: { deleted: number; total: number; percent: number }) => void
	) {
		if (!cleanupJob) return;

		const s3Config = getS3Config(envConfig);
		const s3Client = createS3Client(s3Config);
		const prefix = s3Config.root ? `${s3Config.root}/${cleanupJob.preset}/` : `${cleanupJob.preset}/`;

		log.info(`[thumbnails] Cleaning up preset: ${cleanupJob.preset} (prefix: ${prefix})`);

		const deleted = await deleteS3Prefix(
			s3Client,
			s3Config.bucket,
			prefix,
			onProgress,
			cleanupAbortController?.signal
		);

		log.info(`[thumbnails] Cleanup completed: deleted ${deleted} files from ${cleanupJob.preset}/`);
	}
}
