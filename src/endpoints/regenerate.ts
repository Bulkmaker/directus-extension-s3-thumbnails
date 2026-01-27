import type { Router, Request, Response } from 'express';
import type { Knex } from 'knex';
import { loadConfig } from '../utils/config.js';
import { isImage } from '../utils/mime.js';
import { generateThumbnailsForFile } from '../hooks/on-upload.js';
import { withRetry } from '../services/s3.js';

interface Logger {
	info: (msg: string) => void;
	warn: (msg: string) => void;
	error: (msg: string) => void;
}

interface RegenerateRequest {
	preset?: string;
	force?: boolean;
	fileIds?: string[];
}

interface RegenerateProgress {
	processed: number;
	total: number;
	generated: number;
	skipped: number;
	errors: number;
	percent: number;
	done?: boolean;
	failed?: Array<{ id: string; error: string }>;
}

/**
 * Register regenerate endpoint
 */
export function registerRegenerateEndpoint(
	router: Router,
	database: Knex,
	env: Record<string, string>,
	logger: Logger
) {
	router.post('/regenerate', async (req: Request, res: Response) => {
		const useSSE = req.query.sse === 'true';
		const body = req.body as RegenerateRequest;
		const { preset, force = false, fileIds } = body;

		// Check admin permission
		const accountability = (req as Request & { accountability?: { admin?: boolean } }).accountability;
		if (!accountability?.admin) {
			return res.status(403).json({ error: 'Admin access required' });
		}

		// Setup SSE if requested
		if (useSSE) {
			res.setHeader('Content-Type', 'text/event-stream');
			res.setHeader('Cache-Control', 'no-cache');
			res.setHeader('Connection', 'keep-alive');
			res.flushHeaders();
		}

		const sendProgress = (progress: RegenerateProgress) => {
			if (useSSE) {
				res.write(`data: ${JSON.stringify(progress)}\n\n`);
			}
		};

		try {
			const config = await loadConfig(database, env);

			// Filter presets if specified
			const presetsToProcess = preset
				? config.presets.filter((p) => p.key === preset)
				: config.presets;

			if (presetsToProcess.length === 0) {
				const error = preset
					? `Preset "${preset}" not found`
					: 'No presets configured';

				if (useSSE) {
					sendProgress({ processed: 0, total: 0, generated: 0, skipped: 0, errors: 0, percent: 100, done: true, failed: [] });
					res.end();
				} else {
					res.json({ error, processed: 0, generated: 0 });
				}
				return;
			}

			// Count total files first (for progress calculation)
			let countQuery = database('directus_files')
				.where('type', 'like', 'image/%')
				.count('id as total');

			if (fileIds?.length) {
				countQuery = countQuery.whereIn('id', fileIds);
			}

			const [{ total: totalCount }] = await countQuery;
			const totalFiles = Number(totalCount);

			const progress: RegenerateProgress = {
				processed: 0,
				total: totalFiles,
				generated: 0,
				skipped: 0,
				errors: 0,
				percent: 0,
				failed: [],
			};

			// Process files with pagination to avoid OOM
			const PAGE_SIZE = 100;
			const BATCH_SIZE = 5;
			let offset = 0;
			let hasMore = true;

			while (hasMore) {
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
				for (let i = 0; i < files.length; i += BATCH_SIZE) {
					const batch = files.slice(i, i + BATCH_SIZE);

					const batchResults = await Promise.allSettled(
						batch.map(async (file) => {
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
											database,
											env,
											logger,
											{ force, presets: presetsToProcess }
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

					// Process batch results
					for (const settled of batchResults) {
						if (settled.status === 'fulfilled') {
							const { success, file, result, error } = settled.value;

							if (success && result) {
								progress.generated += result.generated;
								progress.skipped += result.skipped;
							} else {
								progress.errors++;
								progress.failed!.push({ id: file.id, error: error || 'Unknown error' });
								logger.error(`[thumbnails] Failed ${file.id}: ${error}`);
							}
						} else {
							progress.errors++;
						}

						progress.processed++;
					}

					progress.percent = Math.round((progress.processed / progress.total) * 100);
					sendProgress(progress);
				}

				offset += PAGE_SIZE;
			}

			// Final response
			progress.done = true;

			if (useSSE) {
				sendProgress(progress);
				res.end();
			} else {
				res.json({
					processed: progress.processed,
					total: progress.total,
					generated: progress.generated,
					skipped: progress.skipped,
					errors: progress.errors,
					failed: progress.failed,
				});
			}

			logger.info(
				`[thumbnails] Regenerate completed: ${progress.processed} files, ${progress.generated} thumbnails generated, ${progress.errors} errors`
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			const errResponse = { error: message, done: true };

			if (useSSE) {
				res.write(`data: ${JSON.stringify(errResponse)}\n\n`);
				res.end();
			} else {
				res.status(500).json(errResponse);
			}

			logger.error(`[thumbnails] Regenerate error: ${message}`);
		}
	});
}
