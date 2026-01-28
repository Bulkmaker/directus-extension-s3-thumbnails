import type { ThumbnailPreset } from '../utils/config.js';

export interface ProcessedThumbnail {
	buffer: Buffer;
	format: string;
	width: number;
	height: number;
}

type OutputFormat = 'webp' | 'jpg' | 'jpeg' | 'png' | 'avif';

// Directus services type (passed from hook context)
interface DirectusServices {
	AssetsService: new (options: { schema: any; accountability?: any }) => {
		getAsset: (
			id: string,
			options: {
				transformationParams?: {
					width?: number;
					height?: number;
					fit?: string;
					format?: string;
					quality?: number;
					withoutEnlargement?: boolean;
				};
			}
		) => Promise<{ stream: NodeJS.ReadableStream; stat: { size: number } }>;
	};
}

/**
 * Generate thumbnail using Directus AssetsService (internal API)
 * This uses Directus's built-in sharp without HTTP requests
 */
export async function generateThumbnail(
	fileId: string,
	preset: ThumbnailPreset,
	format: OutputFormat,
	services: DirectusServices,
	schema: any
): Promise<ProcessedThumbnail> {
	const { AssetsService } = services;

	// Create assets service with no accountability (internal request)
	const assetsService = new AssetsService({
		schema,
		accountability: null, // null = admin access for internal operations
	});

	// Build transformation parameters
	const transformationParams = {
		width: preset.width,
		height: preset.height,
		fit: preset.fit || 'cover',
		format: format === 'jpg' ? 'jpeg' : format,
		quality: preset.quality || 80,
		withoutEnlargement: preset.withoutEnlargement !== false,
	};

	// Get transformed asset stream
	const { stream } = await assetsService.getAsset(fileId, {
		transformationParams,
	});

	// Collect stream into buffer
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const buffer = Buffer.concat(chunks);

	return {
		buffer,
		format,
		width: preset.width,
		height: preset.height || preset.width,
	};
}
