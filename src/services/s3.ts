import {
	S3Client,
	PutObjectCommand,
	GetObjectCommand,
	DeleteObjectCommand,
	DeleteObjectsCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { getS3Config } from '../utils/config.js';

type S3Config = ReturnType<typeof getS3Config>;

/**
 * Create S3 client from config
 */
export function createS3Client(config: S3Config): S3Client {
	return new S3Client({
		region: config.region,
		endpoint: config.endpoint,
		credentials: config.credentials,
		forcePathStyle: true, // Required for most S3-compatible services
	});
}

/**
 * Retry wrapper with exponential backoff
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	retries = 3,
	baseDelayMs = 1000
): Promise<T> {
	for (let i = 0; i < retries; i++) {
		try {
			return await fn();
		} catch (err) {
			if (i === retries - 1) throw err;
			const delay = baseDelayMs * Math.pow(2, i); // 1s, 2s, 4s
			await new Promise((r) => setTimeout(r, delay));
		}
	}
	throw new Error('Unreachable');
}

/**
 * Upload buffer to S3 with public-read access
 * Files are publicly accessible without Directus proxy
 */
export async function uploadToS3(
	client: S3Client,
	bucket: string,
	key: string,
	body: Buffer,
	contentType: string
): Promise<void> {
	await withRetry(() =>
		client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: key,
				Body: body,
				ContentType: contentType,
				CacheControl: 'public, max-age=31536000', // 1 year
				ACL: 'public-read', // Thumbnails must be publicly accessible
			})
		)
	);
}

/**
 * Get object from S3
 */
export async function getFromS3(
	client: S3Client,
	bucket: string,
	key: string
): Promise<Buffer> {
	const response = await withRetry(() =>
		client.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: key,
			})
		)
	);

	return Buffer.from(await response.Body!.transformToByteArray());
}

/**
 * Check if object exists in S3
 */
export async function existsInS3(
	client: S3Client,
	bucket: string,
	key: string
): Promise<boolean> {
	try {
		await client.send(
			new HeadObjectCommand({
				Bucket: bucket,
				Key: key,
			})
		);
		return true;
	} catch {
		return false;
	}
}

/**
 * Get object metadata (size, content-type, etc.)
 */
export async function getObjectMetadata(
	client: S3Client,
	bucket: string,
	key: string
): Promise<{ size: number; contentType?: string } | null> {
	try {
		const response = await client.send(
			new HeadObjectCommand({
				Bucket: bucket,
				Key: key,
			})
		);
		return {
			size: response.ContentLength ?? 0,
			contentType: response.ContentType,
		};
	} catch {
		return null;
	}
}

/**
 * Delete single object from S3
 */
export async function deleteFromS3(
	client: S3Client,
	bucket: string,
	key: string
): Promise<void> {
	await withRetry(() =>
		client.send(
			new DeleteObjectCommand({
				Bucket: bucket,
				Key: key,
			})
		)
	);
}

/**
 * List objects with given prefix (with pagination)
 */
export async function listS3Objects(
	client: S3Client,
	bucket: string,
	prefix: string
): Promise<string[]> {
	const keys: string[] = [];
	let continuationToken: string | undefined;

	do {
		const response = await withRetry(() =>
			client.send(
				new ListObjectsV2Command({
					Bucket: bucket,
					Prefix: prefix,
					ContinuationToken: continuationToken,
					MaxKeys: 1000,
				})
			)
		);

		for (const obj of response.Contents ?? []) {
			if (obj.Key) keys.push(obj.Key);
		}

		continuationToken = response.NextContinuationToken;
	} while (continuationToken);

	return keys;
}

/**
 * Progress callback for delete operations
 */
export interface DeleteProgressCallback {
	(progress: { deleted: number; total: number; percent: number }): void;
}

/**
 * Delete all objects with given prefix (batch delete with pagination)
 */
export async function deleteS3Prefix(
	client: S3Client,
	bucket: string,
	prefix: string,
	onProgress?: DeleteProgressCallback,
	signal?: AbortSignal
): Promise<number> {
	let deleted = 0;
	let continuationToken: string | undefined;

	// First, count total objects (for progress)
	let total = 0;
	let countToken: string | undefined;
	do {
		if (signal?.aborted) throw new Error('Aborted');

		const response = await withRetry(() =>
			client.send(
				new ListObjectsV2Command({
					Bucket: bucket,
					Prefix: prefix,
					ContinuationToken: countToken,
					MaxKeys: 1000,
				})
			)
		);
		total += response.Contents?.length ?? 0;
		countToken = response.NextContinuationToken;
	} while (countToken);

	if (total === 0) {
		onProgress?.({ deleted: 0, total: 0, percent: 100 });
		return 0;
	}

	onProgress?.({ deleted: 0, total, percent: 0 });

	// Now delete
	do {
		if (signal?.aborted) throw new Error('Aborted');

		const response = await withRetry(() =>
			client.send(
				new ListObjectsV2Command({
					Bucket: bucket,
					Prefix: prefix,
					ContinuationToken: continuationToken,
					MaxKeys: 1000,
				})
			)
		);

		const contents = response.Contents ?? [];
		if (contents.length > 0) {
			await withRetry(() =>
				client.send(
					new DeleteObjectsCommand({
						Bucket: bucket,
						Delete: {
							Objects: contents.map((o) => ({ Key: o.Key! })),
						},
					})
				)
			);
			deleted += contents.length;

			const percent = Math.round((deleted / total) * 100);
			onProgress?.({ deleted, total, percent });
		}

		continuationToken = response.NextContinuationToken;
	} while (continuationToken);

	return deleted;
}

/**
 * List all folder prefixes in S3 bucket (one level deep)
 */
export async function listS3Folders(
	client: S3Client,
	bucket: string,
	rootPrefix: string
): Promise<string[]> {
	const folders: Set<string> = new Set();
	let continuationToken: string | undefined;

	// Ensure root prefix ends with /
	const prefix = rootPrefix ? (rootPrefix.endsWith('/') ? rootPrefix : `${rootPrefix}/`) : '';

	do {
		const response = await withRetry(() =>
			client.send(
				new ListObjectsV2Command({
					Bucket: bucket,
					Prefix: prefix,
					Delimiter: '/',
					ContinuationToken: continuationToken,
				})
			)
		);

		// CommonPrefixes contains the "folders"
		for (const cp of response.CommonPrefixes ?? []) {
			if (cp.Prefix) {
				// Extract folder name from prefix
				// e.g., "root/16-9mini/" -> "16-9mini"
				const folderPath = cp.Prefix.replace(prefix, '').replace(/\/$/, '');
				if (folderPath) {
					folders.add(folderPath);
				}
			}
		}

		continuationToken = response.NextContinuationToken;
	} while (continuationToken);

	return Array.from(folders);
}

/**
 * Count objects in S3 prefix
 */
export async function countS3Objects(
	client: S3Client,
	bucket: string,
	prefix: string
): Promise<number> {
	let count = 0;
	let continuationToken: string | undefined;

	do {
		const response = await withRetry(() =>
			client.send(
				new ListObjectsV2Command({
					Bucket: bucket,
					Prefix: prefix,
					ContinuationToken: continuationToken,
					MaxKeys: 1000,
				})
			)
		);

		count += response.Contents?.length ?? 0;
		continuationToken = response.NextContinuationToken;
	} while (continuationToken);

	return count;
}

/**
 * Preset config stored in S3 for change detection
 */
export interface StoredPresetConfig {
	hash: string;
	config: {
		width: number;
		height: number;
		fit: string;
		quality: number;
		format: string;
	};
	updatedAt: string;
}

const PRESET_CONFIG_FILENAME = '.preset-config.json';

/**
 * Get the S3 key for preset config file
 */
export function getPresetConfigKey(root: string, presetKey: string): string {
	const key = `${presetKey}/${PRESET_CONFIG_FILENAME}`;
	return root ? `${root}/${key}` : key;
}

/**
 * Save preset config to S3
 */
export async function savePresetConfig(
	client: S3Client,
	bucket: string,
	root: string,
	presetKey: string,
	config: StoredPresetConfig
): Promise<void> {
	const key = getPresetConfigKey(root, presetKey);
	const body = JSON.stringify(config, null, 2);

	await withRetry(() =>
		client.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: key,
				Body: body,
				ContentType: 'application/json',
				// No public ACL needed - this is internal metadata
			})
		)
	);
}

/**
 * Load preset config from S3
 * Returns null if config doesn't exist
 */
export async function loadPresetConfig(
	client: S3Client,
	bucket: string,
	root: string,
	presetKey: string
): Promise<StoredPresetConfig | null> {
	const key = getPresetConfigKey(root, presetKey);

	try {
		const response = await client.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: key,
			})
		);

		const body = await response.Body?.transformToString();
		if (!body) return null;

		return JSON.parse(body) as StoredPresetConfig;
	} catch {
		// File doesn't exist or parse error
		return null;
	}
}
