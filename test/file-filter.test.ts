import { describe, it, expect, beforeEach } from 'vitest';
import {
	getFileFilterConfig,
	isFilterEnabled,
	getSkipReason,
	resolveSkippedFolders,
	clearFolderCache,
} from '../src/utils/file-filter.js';

const folders = [
	{ id: 'root', parent: null },
	{ id: 'child', parent: 'root' },
	{ id: 'grandchild', parent: 'child' },
	{ id: 'other', parent: null },
];

function makeDb(files: Record<string, { storage: string; folder: string | null }> = {}) {
	return ((table: string) => {
		if (table === 'directus_folders') {
			return {
				whereIn: (_col: string, parents: string[]) => ({
					select: async () => folders.filter((f) => f.parent && parents.includes(f.parent)).map((f) => ({ id: f.id })),
				}),
			};
		}
		return {
			where: (_col: string, id: string) => ({
				select: () => ({ first: async () => files[id] }),
			}),
		};
	}) as any;
}

beforeEach(() => clearFolderCache());

describe('getFileFilterConfig', () => {
	it('is off by default', () => {
		const c = getFileFilterConfig({});
		expect(c.storages).toBeNull();
		expect(c.skipFolders).toEqual([]);
		expect(isFilterEnabled(c)).toBe(false);
	});

	it('parses comma lists with spaces and empties', () => {
		const c = getFileFilterConfig({ THUMBNAILS_STORAGES: ' s3, s3b ,', THUMBNAILS_SKIP_FOLDERS: 'a, b' });
		expect(c.storages).toEqual(['s3', 's3b']);
		expect(c.skipFolders).toEqual(['a', 'b']);
		expect(isFilterEnabled(c)).toBe(true);
	});

	it('empty string means off', () => {
		expect(getFileFilterConfig({ THUMBNAILS_STORAGES: '  ' }).storages).toBeNull();
	});
});

describe('storage filter', () => {
	it('filter off: nothing is skipped and DB is not queried', async () => {
		const db = (() => {
			throw new Error('db must not be called');
		}) as any;
		expect(await getSkipReason(db, {}, { id: 'f1', storage: 'local', folder: null })).toBeNull();
	});

	it('file in list is processed, outside the list is skipped', async () => {
		const env = { THUMBNAILS_STORAGES: 's3' };
		const db = makeDb();
		expect(await getSkipReason(db, env, { id: 'f1', storage: 's3', folder: null })).toBeNull();
		expect(await getSkipReason(db, env, { id: 'f2', storage: 'local', folder: null })).toBe('storage');
	});

	it('reads storage from DB when not in payload', async () => {
		const env = { THUMBNAILS_STORAGES: 's3' };
		const db = makeDb({ a: { storage: 's3', folder: null }, b: { storage: 'local', folder: null } });
		expect(await getSkipReason(db, env, { id: 'a' })).toBeNull();
		expect(await getSkipReason(db, env, { id: 'b' })).toBe('storage');
	});

	it('unknown file (no row) is skipped when the storage filter is on', async () => {
		expect(await getSkipReason(makeDb(), { THUMBNAILS_STORAGES: 's3' }, { id: 'zzz' })).toBe('storage');
	});
});

describe('folder filter', () => {
	it('resolves nested folders', async () => {
		const ids = await resolveSkippedFolders(makeDb(), ['root']);
		expect([...ids].sort()).toEqual(['child', 'grandchild', 'root']);
	});

	it('skips file in a listed folder and in a nested folder, keeps others', async () => {
		const env = { THUMBNAILS_SKIP_FOLDERS: 'root' };
		const db = makeDb();
		expect(await getSkipReason(db, env, { id: '1', storage: 's3', folder: 'root' })).toBe('folder');
		expect(await getSkipReason(db, env, { id: '2', storage: 's3', folder: 'grandchild' })).toBe('folder');
		expect(await getSkipReason(db, env, { id: '3', storage: 's3', folder: 'other' })).toBeNull();
		expect(await getSkipReason(db, env, { id: '4', storage: 's3', folder: null })).toBeNull();
	});

	it('both filters combine', async () => {
		const env = { THUMBNAILS_STORAGES: 's3', THUMBNAILS_SKIP_FOLDERS: 'root' };
		const db = makeDb();
		expect(await getSkipReason(db, env, { id: '1', storage: 'local', folder: 'other' })).toBe('storage');
		expect(await getSkipReason(db, env, { id: '2', storage: 's3', folder: 'child' })).toBe('folder');
		expect(await getSkipReason(db, env, { id: '3', storage: 's3', folder: 'other' })).toBeNull();
	});
});
