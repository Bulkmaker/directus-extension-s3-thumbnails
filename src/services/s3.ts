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
 * Delete all objects with given prefix (batch delete with pagination)
 */
export async function deleteS3Prefix(
	client: S3Client,
	bucket: string,
	prefix: string
): Promise<number> {
	let deleted = 0;
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
		}

		continuationToken = response.NextContinuationToken;
	} while (continuationToken);

	return deleted;
}
