import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Readable } from 'node:stream';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';

/**
 * Локальный HTTP-прокси с поддержкой Range поверх S3-объекта.
 *
 * Зачем: ffmpeg читает видео по HTTP Range и скачивает только нужные куски
 * (moov + один GOP) вместо всего файла. Но напрямую с S3 это не всегда
 * работает: статические сборки ffmpeg на alpine/musl не резолвят DNS-имена
 * (`Failed to resolve hostname`), плюс TLS/подпись. Прокси слушает 127.0.0.1
 * (IP-литерал, без DNS и TLS), а S3-запросы делает AWS SDK процесса Directus.
 */
export interface RangeProxy {
	url: string;
	close: () => Promise<void>;
}

export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
	if (!header) return null;
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m || (m[1] === '' && m[2] === '')) return null;

	let start: number;
	let end: number;
	if (m[1] === '') {
		// suffix: последние N байт
		const n = parseInt(m[2], 10);
		start = Math.max(0, size - n);
		end = size - 1;
	} else {
		start = parseInt(m[1], 10);
		end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
	}
	if (!(start <= end) || start >= size) return null;
	return { start, end };
}

export async function startRangeProxy(
	client: Pick<S3Client, 'send'>,
	bucket: string,
	key: string,
	size: number
): Promise<RangeProxy> {
	const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
		try {
			const range = parseRange(req.headers.range, size);

			if (req.headers.range && !range) {
				res.writeHead(416, { 'Content-Range': `bytes */${size}` });
				return res.end();
			}

			const start = range ? range.start : 0;
			const end = range ? range.end : size - 1;

			res.writeHead(range ? 206 : 200, {
				'Accept-Ranges': 'bytes',
				'Content-Type': 'application/octet-stream',
				'Content-Length': String(end - start + 1),
				...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
			});

			if (req.method === 'HEAD' || size === 0) return res.end();

			const response = await client.send(
				new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=${start}-${end}` })
			);
			const body = response.Body as Readable;
			res.on('close', () => body.destroy());
			body.on('error', () => res.destroy());
			body.pipe(res);
		} catch {
			if (!res.headersSent) res.writeHead(502);
			res.destroy();
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});

	const { port } = server.address() as AddressInfo;

	return {
		url: `http://127.0.0.1:${port}/video`,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections?.();
				server.close(() => resolve());
			}),
	};
}
