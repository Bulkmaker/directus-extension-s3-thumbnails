import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/services/s3.js', () => ({
	createS3Client: vi.fn(() => ({})),
	listS3Objects: vi.fn(async (_c: unknown, _b: string, prefix: string) => [`${prefix}webp`]),
	deleteFromS3: vi.fn(async () => {}),
}));

import * as s3 from '../src/services/s3.js';
import { createDeleteHandler, createDeletePrefetch } from '../src/hooks/on-delete.js';

const presets = [{ key: 'card', width: 400 }, { key: 'hero', width: 1600 }];

function makeDb(rows: Array<{ id: string; filename_disk: string; type: string }>) {
	return ((table: string) => {
		if (table === 'directus_settings') {
			return { select: () => ({ first: async () => ({ storage_asset_presets: presets }) }) };
		}
		return { whereIn: () => ({ select: async () => rows }) };
	}) as any;
}

const env = { STORAGE_S3_BUCKET: 'bucket', STORAGE_S3_ROOT: '' } as Record<string, string>;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe('files.delete cleanup', () => {
	it('removes variants of a deleted video (prefetch filter + action)', async () => {
		const rows = [{ id: 'v1', filename_disk: 'aaaa.mp4', type: 'video/mp4' }];
		const db = makeDb(rows);

		const keys = await createDeletePrefetch(db)(['v1']);
		expect(keys).toEqual(['v1']);

		await createDeleteHandler(db, env, logger)({ payload: ['v1'], keys: ['v1'], collection: 'directus_files' });

		const deleted = (s3.deleteFromS3 as any).mock.calls.map((c: any[]) => c[2]);
		expect(deleted).toEqual(['card/aaaa.webp', 'hero/aaaa.webp']);
		// префикс заканчивается точкой: не заденет aaaa1.*
		expect((s3.listS3Objects as any).mock.calls[0][2]).toBe('card/aaaa.');
	});

	it('removes variants of images too', async () => {
		const db = makeDb([{ id: 'i1', filename_disk: 'bbbb.jpg', type: 'image/jpeg' }]);
		await createDeletePrefetch(db)(['i1']);
		await createDeleteHandler(db, env, logger)({ payload: ['i1'], keys: ['i1'], collection: 'directus_files' });
		expect(s3.deleteFromS3).toHaveBeenCalledTimes(2);
	});

	it('ignores other file types (pdf)', async () => {
		const db = makeDb([{ id: 'p1', filename_disk: 'cccc.pdf', type: 'application/pdf' }]);
		await createDeletePrefetch(db)(['p1']);
		await createDeleteHandler(db, env, logger)({ payload: ['p1'], keys: ['p1'], collection: 'directus_files' });
		expect(s3.listS3Objects).not.toHaveBeenCalled();
	});

	it('never breaks the delete: prefetch swallows DB errors and returns keys', async () => {
		const badDb = (() => ({ whereIn: () => ({ select: async () => { throw new Error('db'); } }) })) as any;
		await expect(createDeletePrefetch(badDb)(['x'])).resolves.toEqual(['x']);
	});

	it('ignores foreign collections', async () => {
		const db = makeDb([]);
		await createDeleteHandler(db, env, logger)({ payload: ['1'], keys: ['1'], collection: 'articles' });
		expect(s3.listS3Objects).not.toHaveBeenCalled();
	});
});
