import { createRequire } from 'node:module';
import type { ThumbnailPreset } from '../utils/config.js';

/**
 * Прогон готового кадра (буфер) через пресет: тот же набор параметров, что
 * Directus AssetsService применяет к картинкам (width/height/fit/quality/
 * withoutEnlargement/format), на том же sharp, который идёт в образе Directus.
 */

type SharpFactory = (input: Buffer) => any;

let cachedSharp: SharpFactory | null = null;

/**
 * sharp в образе Directus лежит в pnpm-сторе (/directus/node_modules/.pnpm/...),
 * из каталога расширения напрямую не резолвится. Ищем: сам `sharp` → через
 * `@directus/api` (его зависимость).
 */
export function loadSharp(): SharpFactory {
	if (cachedSharp) return cachedSharp;

	const req = createRequire(import.meta.url);
	const errors: string[] = [];

	const tryLoad = (r: NodeRequire): SharpFactory | null => {
		try {
			const mod = r('sharp');
			return (mod?.default ?? mod) as SharpFactory;
		} catch (e) {
			errors.push(e instanceof Error ? e.message.split('\n')[0] : String(e));
			return null;
		}
	};

	let sharp = tryLoad(req);

	if (!sharp) {
		try {
			const apiPkg = req.resolve('@directus/api/package.json');
			sharp = tryLoad(createRequire(apiPkg));
		} catch (e) {
			errors.push(e instanceof Error ? e.message.split('\n')[0] : String(e));
		}
	}

	if (!sharp) {
		throw new Error(`sharp is not available (${errors.join('; ')})`);
	}

	cachedSharp = sharp;
	return sharp;
}

export interface PresetOutput {
	buffer: Buffer;
	format: string;
	width?: number;
	height?: number;
}

export async function processBufferWithPreset(
	input: Buffer,
	preset: ThumbnailPreset,
	format: string,
	sharpFactory: SharpFactory = loadSharp()
): Promise<PresetOutput> {
	const sharpFormat = format === 'jpg' ? 'jpeg' : format;
	let pipeline = sharpFactory(input).rotate();

	if (preset.width || preset.height) {
		pipeline = pipeline.resize({
			width: preset.width || undefined,
			height: preset.height || undefined,
			fit: preset.fit || 'cover',
			withoutEnlargement: preset.withoutEnlargement !== false,
		});
	}

	pipeline = pipeline.toFormat(sharpFormat, { quality: preset.quality || 80 });

	const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

	return { buffer: data, format, width: info?.width, height: info?.height };
}
