/**
 * Check if MIME type is an image
 */
export function isImage(mimeType: string | null | undefined): boolean {
	return !!mimeType && mimeType.startsWith('image/');
}

/**
 * Get MIME type for image format
 */
export function getMimeType(format: string): string {
	const mimeTypes: Record<string, string> = {
		webp: 'image/webp',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		avif: 'image/avif',
		gif: 'image/gif',
	};

	return mimeTypes[format.toLowerCase()] || 'application/octet-stream';
}

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMime(mimeType: string): string {
	const extensions: Record<string, string> = {
		'image/webp': 'webp',
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/avif': 'avif',
		'image/gif': 'gif',
	};

	return extensions[mimeType] || 'bin';
}

/**
 * Get basename (filename without extension)
 */
export function getBasename(filename: string): string {
	const lastDot = filename.lastIndexOf('.');
	return lastDot > 0 ? filename.substring(0, lastDot) : filename;
}

/**
 * Build S3 key for thumbnail
 */
export function buildThumbnailKey(
	root: string,
	preset: string,
	basename: string,
	format: string
): string {
	const key = `${preset}/${basename}.${format}`;
	return root ? `${root}/${key}` : key;
}

/**
 * Build S3 key for original file
 */
export function buildOriginalKey(root: string, filename: string): string {
	return root ? `${root}/${filename}` : filename;
}
