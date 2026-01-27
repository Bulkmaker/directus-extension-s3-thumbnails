import type { Knex } from 'knex';

export interface ThumbnailPreset {
	key: string;
	width?: number;
	height?: number;
	fit?: 'contain' | 'cover' | 'inside' | 'outside';
	quality?: number;
	withoutEnlargement?: boolean;
	format?: string; // from Directus preset
}

export interface ThumbnailConfig {
	presets: ThumbnailPreset[];
	verbose: boolean;
}

/**
 * Load thumbnail configuration from Directus settings
 * All settings come from Directus - no ENV duplication
 */
export async function loadConfig(
	database: Knex,
	env: Record<string, string>
): Promise<ThumbnailConfig> {
	// Read presets from directus_settings
	let presets: ThumbnailPreset[] = [];

	try {
		const settings = await database('directus_settings')
			.select('storage_asset_presets')
			.first();

		const allPresets: ThumbnailPreset[] = settings?.storage_asset_presets ?? [];

		// Filter out presets with huge dimensions (e.g., "original" preset with 9999x9999)
		// These would timeout the Transform API and aren't real thumbnails
		const MAX_DIMENSION = 5000;
		presets = allPresets.filter((p) => {
			const w = p.width || 0;
			const h = p.height || 0;
			return w < MAX_DIMENSION && h < MAX_DIMENSION;
		});
	} catch {
		// Table might not exist or field missing - use empty presets
		presets = [];
	}

	// Verbose logging (only ENV option left)
	const verbose = env['THUMBNAILS_VERBOSE'] === 'true';

	return {
		presets,
		verbose,
	};
}

/**
 * Get output format for a preset
 * Uses preset.format if specified, otherwise defaults to webp
 */
export function getPresetFormat(preset: ThumbnailPreset): string {
	const format = preset.format?.toLowerCase();

	// 'auto' or undefined -> webp
	if (!format || format === 'auto' || format === '') {
		return 'webp';
	}

	// normalize jpeg -> jpg
	if (format === 'jpeg') {
		return 'jpg';
	}

	return format;
}

/**
 * Get S3 configuration from ENV
 */
export function getS3Config(env: Record<string, string>) {
	return {
		region: env['STORAGE_S3_REGION'] || 'us-east-1',
		endpoint: env['STORAGE_S3_ENDPOINT'],
		bucket: env['STORAGE_S3_BUCKET'],
		root: env['STORAGE_S3_ROOT'] || '',
		credentials: {
			accessKeyId: env['STORAGE_S3_KEY'],
			secretAccessKey: env['STORAGE_S3_SECRET'],
		},
	};
}
