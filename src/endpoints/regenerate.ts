import type { Router, Request, Response } from 'express';
import type { Knex } from 'knex';
import { randomUUID } from 'crypto';
import { loadConfig } from '../utils/config.js';
import { generateThumbnailsForFile } from '../hooks/on-upload.js';
import { withRetry } from '../services/s3.js';

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

interface RegenerateRequest {
	preset?: string;
	force?: boolean;
	fileIds?: string[];
}

interface JobProgress {
	processed: number;
	total: number;
	generated: number;
	skipped: number;
	errors: number;
	percent: number;
}

interface JobState {
	id: string;
	status: 'running' | 'completed' | 'cancelled' | 'error';
	startedAt: Date;
	completedAt?: Date;
	options: { preset?: string; force: boolean; fileIds?: string[] };
	progress: JobProgress;
	failed: Array<{ id: string; error: string }>;
	error?: string;
}

// Global state — singleton job
let currentJob: JobState | null = null;
let jobAbortController: AbortController | null = null;

/**
 * Register regenerate endpoints
 */
export function registerRegenerateEndpoint(router: Router, context: HookContext) {
	const { database, env, logger } = context;

	// POST /regenerate — start new job
	router.post('/regenerate', async (req: Request, res: Response) => {
		const body = req.body as RegenerateRequest;
		const { preset, force = false, fileIds } = body;

		// Check admin permission
		const accountability = (req as Request & { accountability?: { admin?: boolean } }).accountability;
		if (!accountability?.admin) {
			return res.status(403).json({ error: 'Admin access required' });
		}

		// Check if job already running
		if (currentJob?.status === 'running') {
			return res.status(409).json({
				error: 'Job already running',
				jobId: currentJob.id,
				progress: currentJob.progress,
			});
		}

		// Load config to validate preset
		const config = await loadConfig(database, env);
		const presetsToProcess = preset
			? config.presets.filter((p) => p.key === preset)
			: config.presets;

		if (presetsToProcess.length === 0) {
			return res.status(400).json({
				error: preset ? `Preset "${preset}" not found` : 'No presets configured',
			});
		}

		// Count total files
		let countQuery = database('directus_files')
			.where('type', 'like', 'image/%')
			.count('id as total');

		if (fileIds?.length) {
			countQuery = countQuery.whereIn('id', fileIds);
		}

		const [{ total: totalCount }] = await countQuery;
		const totalFiles = Number(totalCount);

		if (totalFiles === 0) {
			return res.json({
				jobId: null,
				status: 'completed',
				message: 'No files to process',
			});
		}

		// Create new job
		const jobId = randomUUID();
		currentJob = {
			id: jobId,
			status: 'running',
			startedAt: new Date(),
			options: { preset, force, fileIds },
			progress: {
				processed: 0,
				total: totalFiles,
				generated: 0,
				skipped: 0,
				errors: 0,
				percent: 0,
			},
			failed: [],
		};

		jobAbortController = new AbortController();

		// Start processing in background
		processRegeneration(context, presetsToProcess, jobAbortController.signal).catch((err) => {
			logger.error(`[thumbnails] Job ${jobId} failed: ${err}`);
		});

		logger.info(`[thumbnails] Job ${jobId} started: ${totalFiles} files, ${presetsToProcess.length} presets`);

		res.json({
			jobId,
			status: 'started',
			total: totalFiles,
		});
	});

	// GET /regenerate/status — get current job status (supports SSE)
	router.get('/regenerate/status', (req: Request, res: Response) => {
		const useSSE = req.query.sse === 'true';

		// Check admin permission
		const accountability = (req as Request & { accountability?: { admin?: boolean } }).accountability;
		if (!accountability?.admin) {
			return res.status(403).json({ error: 'Admin access required' });
		}

		if (!currentJob) {
			if (useSSE) {
				res.setHeader('Content-Type', 'text/event-stream');
				res.setHeader('Cache-Control', 'no-cache');
				res.setHeader('Connection', 'keep-alive');
				res.flushHeaders();
				res.write(`data: ${JSON.stringify({ status: 'idle' })}\n\n`);
				res.end();
			} else {
				res.json({ status: 'idle' });
			}
			return;
		}

		if (useSSE) {
			res.setHeader('Content-Type', 'text/event-stream');
			res.setHeader('Cache-Control', 'no-cache');
			res.setHeader('Connection', 'keep-alive');
			res.flushHeaders();

			// Send current state immediately
			const sendState = () => {
				if (!currentJob) {
					res.write(`data: ${JSON.stringify({ status: 'idle' })}\n\n`);
					return false;
				}
				res.write(`data: ${JSON.stringify({
					id: currentJob.id,
					status: currentJob.status,
					...currentJob.progress,
					failed: currentJob.failed,
				})}\n\n`);
				return currentJob.status === 'running';
			};

			sendState();

			// Poll for updates while running
			const interval = setInterval(() => {
				const shouldContinue = sendState();
				if (!shouldContinue) {
					clearInterval(interval);
					res.end();
				}
			}, 500);

			req.on('close', () => {
				clearInterval(interval);
			});
		} else {
			res.json({
				id: currentJob.id,
				status: currentJob.status,
				startedAt: currentJob.startedAt,
				completedAt: currentJob.completedAt,
				options: currentJob.options,
				progress: currentJob.progress,
				failed: currentJob.failed,
				error: currentJob.error,
			});
		}
	});

	// DELETE /regenerate — cancel running job
	router.delete('/regenerate', (req: Request, res: Response) => {
		// Check admin permission
		const accountability = (req as Request & { accountability?: { admin?: boolean } }).accountability;
		if (!accountability?.admin) {
			return res.status(403).json({ error: 'Admin access required' });
		}

		if (!currentJob || currentJob.status !== 'running') {
			return res.json({ cancelled: false, reason: 'No running job' });
		}

		if (jobAbortController) {
			jobAbortController.abort();
		}

		currentJob.status = 'cancelled';
		currentJob.completedAt = new Date();

		logger.info(`[thumbnails] Job ${currentJob.id} cancelled`);

		res.json({ cancelled: true, jobId: currentJob.id });
	});

	// Background processing function
	async function processRegeneration(
		ctx: HookContext,
		presets: Array<{ key: string; width?: number; height?: number; format?: string }>,
		signal: AbortSignal
	) {
		if (!currentJob) return;

		const { database } = ctx;
		const { fileIds } = currentJob.options;
		const force = currentJob.options.force;

		const PAGE_SIZE = 100;
		const BATCH_SIZE = 5;
		let offset = 0;
		let hasMore = true;

		try {
			while (hasMore && !signal.aborted) {
				// Fetch page of files
				let query = database('directus_files')
					.select('id', 'filename_disk', 'filename_download', 'type')
					.where('type', 'like', 'image/%')
					.limit(PAGE_SIZE)
					.offset(offset);

				if (fileIds?.length) {
					query = query.whereIn('id', fileIds);
				}

				const files = await query;

				if (files.length < PAGE_SIZE) {
					hasMore = false;
				}

				// Process current page in batches
				for (let i = 0; i < files.length && !signal.aborted; i += BATCH_SIZE) {
					const batch = files.slice(i, i + BATCH_SIZE);

					const batchResults = await Promise.allSettled(
						batch.map(async (file) => {
							if (signal.aborted) {
								throw new Error('Aborted');
							}

							try {
								const result = await withRetry(
									() =>
										generateThumbnailsForFile(
											{
												id: file.id,
												filename_disk: file.filename_disk,
												filename_download: file.filename_download,
												type: file.type,
											},
											ctx,
											{ force, presets }
										),
									3
								);

								return { success: true, file, result };
							} catch (err) {
								const message = err instanceof Error ? err.message : String(err);
								return { success: false, file, error: message };
							}
						})
					);

					// Update progress
					for (const settled of batchResults) {
						if (settled.status === 'fulfilled') {
							const { success, file, result, error } = settled.value;

							if (success && result) {
								currentJob!.progress.generated += result.generated;
								currentJob!.progress.skipped += result.skipped;
							} else {
								currentJob!.progress.errors++;
								currentJob!.failed.push({ id: file.id, error: error || 'Unknown error' });
								logger.error(`[thumbnails] Failed ${file.id}: ${error}`);
							}
						} else {
							currentJob!.progress.errors++;
						}

						currentJob!.progress.processed++;
					}

					currentJob!.progress.percent = Math.round(
						(currentJob!.progress.processed / currentJob!.progress.total) * 100
					);
				}

				offset += PAGE_SIZE;
			}

			// Mark as completed (if not cancelled)
			if (currentJob && currentJob.status === 'running') {
				currentJob.status = 'completed';
				currentJob.completedAt = new Date();

				logger.info(
					`[thumbnails] Job ${currentJob.id} completed: ${currentJob.progress.processed} files, ` +
					`${currentJob.progress.generated} generated, ${currentJob.progress.errors} errors`
				);
			}
		} catch (error: unknown) {
			if (currentJob && currentJob.status === 'running') {
				currentJob.status = 'error';
				currentJob.error = error instanceof Error ? error.message : String(error);
				currentJob.completedAt = new Date();

				logger.error(`[thumbnails] Job ${currentJob.id} error: ${currentJob.error}`);
			}
		}
	}
}
