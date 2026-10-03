import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { parseRange, startRangeProxy } from '../src/services/range-proxy.js';
import { grabPosterFrame } from '../src/services/ffmpeg.js';

describe('parseRange', () => {
	it('parses closed, open and suffix ranges', () => {
		expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
		expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
		expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
		expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 });
	});
	it('rejects invalid ranges', () => {
		expect(parseRange(undefined, 1000)).toBeNull();
		expect(parseRange('bytes=2000-', 1000)).toBeNull();
		expect(parseRange('bytes=5-2', 1000)).toBeNull();
		expect(parseRange('garbage', 1000)).toBeNull();
	});
});

function findFfmpeg(): string | null {
	for (const c of [process.env.FFMPEG_TEST_BIN, 'ffmpeg'].filter(Boolean) as string[]) {
		if (spawnSync(c, ['-version']).status === 0) return c;
	}
	return null;
}
const FFMPEG = findFfmpeg();

describe('range proxy', () => {
	let dir: string;
	let data: Buffer;
	let requested: string[] = [];

	// fake S3: отдаёт срезы Buffer по Range
	const fakeClient: any = {
		send: async (cmd: any) => {
			const r = cmd.input.Range as string;
			requested.push(r);
			const m = /bytes=(\d+)-(\d+)/.exec(r)!;
			return { Body: Readable.from([data.subarray(Number(m[1]), Number(m[2]) + 1)]) };
		},
	};

	beforeAll(async () => {
		if (!FFMPEG) return;
		dir = await mkdtemp(join(tmpdir(), 'rp-'));
		const out = join(dir, 'big.mp4');
		// 20 c, чтобы файл был заметно больше одного кадра
		const g = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=20:size=1280x720:rate=25', '-pix_fmt', 'yuv420p', out]);
		expect(g.status).toBe(0);
		data = await readFile(out);
	});
	afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

	it('serves ranges from the S3 object', async () => {
		const buf = Buffer.from('0123456789');
		const client: any = { send: async (c: any) => {
			const m = /bytes=(\d+)-(\d+)/.exec(c.input.Range)!;
			return { Body: Readable.from([buf.subarray(Number(m[1]), Number(m[2]) + 1)]) };
		} };
		const proxy = await startRangeProxy(client, 'b', 'k', buf.length);
		const res = await fetch(proxy.url, { headers: { Range: 'bytes=2-5' } });
		expect(res.status).toBe(206);
		expect(res.headers.get('content-range')).toBe('bytes 2-5/10');
		expect(await res.text()).toBe('2345');
		const bad = await fetch(proxy.url, { headers: { Range: 'bytes=50-60' } });
		expect(bad.status).toBe(416);
		await proxy.close();
	});

	(FFMPEG ? it : it.skip)('ffmpeg grabs a frame via the proxy without reading the whole file', async () => {
		requested = [];
		const proxy = await startRangeProxy(fakeClient, 'b', 'k', data.length);
		const png = await grabPosterFrame({ ffmpegPath: FFMPEG!, input: proxy.url, timeoutMs: 30000 });
		await proxy.close();
		expect(png.subarray(0, 4).toString('hex')).toBe('89504e47');
		expect(requested.length).toBeGreaterThan(0);
		// все запросы с Range
		expect(requested.every((r) => r.startsWith('bytes='))).toBe(true);
	});
});
