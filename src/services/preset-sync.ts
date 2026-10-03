import type { S3Client } from '@aws-sdk/client-s3';
import { getNormalizedPresetConfig, computePresetConfigHash, type ThumbnailPreset } from '../utils/config.js';
import { savePresetConfig, type StoredPresetConfig } from './s3.js';

interface Logger {
	info: (msg: string) => void;
	warn: (msg: string) => void;
	error: (msg: string) => void;
}

// Какие пресеты уже сохранили в S3 (_config.json) в этой сессии процесса
const presetConfigSaved = new Set<string>();

/**
 * Сохранить конфиг пресета в S3 (один раз на пресет за сессию) — по нему
 * определяется «устаревший» пресет. Ошибка не критична.
 */
export async function ensurePresetConfigSaved(
	s3Client: S3Client,
	bucket: string,
	root: string,
	preset: ThumbnailPreset,
	logger: Logger,
	verbose: boolean
): Promise<void> {
	const presetCacheKey = `${bucket}:${preset.key}`;
	if (presetConfigSaved.has(presetCacheKey)) return;

	try {
		const hash = computePresetConfigHash(preset);
		const storedConfig: StoredPresetConfig = {
			hash,
			config: getNormalizedPresetConfig(preset),
			updatedAt: new Date().toISOString(),
		};
		await savePresetConfig(s3Client, bucket, root, preset.key, storedConfig);
		presetConfigSaved.add(presetCacheKey);
		if (verbose) {
			logger.info(`[thumbnails] Saved preset config: ${preset.key} (hash: ${hash})`);
		}
	} catch (configError) {
		const msg = configError instanceof Error ? configError.message : String(configError);
		logger.warn(`[thumbnails] Failed to save preset config for ${preset.key}: ${msg}`);
	}
}
