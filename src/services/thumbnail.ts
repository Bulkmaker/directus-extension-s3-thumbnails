import type { ThumbnailPreset } from '../utils/config.js';

export interface ProcessedThumbnail {
	buffer: Buffer;
	format: string;
	width: number;
	height: number;
}

type OutputFormat = 'webp' | 'jpg' | 'jpeg' | 'png' | 'avif';

/**
 * Generate thumbnail using Directus Transform API
 * This uses Directus's built-in sharp instead of bundling our own
 */
export async function generateThumbnail(
	fileId: string,
	preset: ThumbnailPreset,
	format: OutputFormat,
	env: Record<string, string>
): Promise<ProcessedThumbnail> {
	// Build Directus assets URL with transform parameters
	// Always use localhost for internal requests (hooks run inside Directus container)
	const baseUrl = 'http://localhost:8055';
	const params = new URLSearchParams({
		width: String(preset.width),
		height: String(preset.height),
		fit: preset.fit || 'cover',
		format: format === 'jpg' ? 'jpeg' : format,
		quality: String(preset.quality || 80),
	});

	// withoutEnlargement is default true in Directus
	if (preset.withoutEnlargement === false) {
		params.set('withoutEnlargement', 'false');
	}

	const url = `${baseUrl}/assets/${fileId}?${params.toString()}`;

	// Use admin token for internal requests
	// IMPORTANT: SECRET is the JWT signing key, NOT an access token
	const token = env['ADMIN_ACCESS_TOKEN'];
	const headers: Record<string, string> = {};
	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}
	// Note: If no token, request will work for public files only

	const response = await fetch(url, { headers });

	if (!response.ok) {
		throw new Error(`Directus transform failed: ${response.status} ${response.statusText}`);
	}

	const arrayBuffer = await response.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);

	return {
		buffer,
		format,
		width: preset.width,
		height: preset.height || preset.width,
	};
}
