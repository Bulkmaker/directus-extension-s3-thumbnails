import type { Knex } from 'knex';

/**
 * Фильтры файлов (всё из ENV, по умолчанию ВЫКЛЮЧЕНЫ):
 *
 * THUMBNAILS_STORAGES=s3            список локаций хранения (directus_files.storage) через запятую;
 *                                   обрабатываются только файлы из этих локаций
 * THUMBNAILS_SKIP_FOLDERS=id1,id2   id папок, файлы из которых пропускаются (включая вложенные папки)
 */
export interface FileFilterConfig {
	/** null = фильтр по локации выключен */
	storages: string[] | null;
	skipFolders: string[];
}

export interface FileLocation {
	storage?: string | null;
	folder?: string | null;
}

export type SkipReason = 'storage' | 'folder';

function parseList(value: string | undefined): string[] {
	return String(value ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

export function getFileFilterConfig(env: Record<string, string | undefined>): FileFilterConfig {
	const storages = parseList(env['THUMBNAILS_STORAGES']);
	return {
		storages: storages.length > 0 ? storages : null,
		skipFolders: parseList(env['THUMBNAILS_SKIP_FOLDERS']),
	};
}

export function isFilterEnabled(cfg: FileFilterConfig): boolean {
	return cfg.storages !== null || cfg.skipFolders.length > 0;
}

/**
 * Набор id папок для пропуска: заданные + все вложенные (обход directus_folders.parent).
 */
const FOLDER_CACHE_TTL_MS = 30_000;
let folderCache: { key: string; at: number; ids: Set<string> } | null = null;

export function clearFolderCache() {
	folderCache = null;
}

export async function resolveSkippedFolders(database: Knex, roots: string[]): Promise<Set<string>> {
	if (roots.length === 0) return new Set();

	const key = roots.join(',');
	if (folderCache && folderCache.key === key && Date.now() - folderCache.at < FOLDER_CACHE_TTL_MS) {
		return folderCache.ids;
	}

	const all = new Set<string>(roots);
	let frontier = [...roots];
	while (frontier.length > 0) {
		const children: Array<{ id: string }> = await database('directus_folders').whereIn('parent', frontier).select('id');
		frontier = [];
		for (const c of children) {
			if (!all.has(c.id)) {
				all.add(c.id);
				frontier.push(c.id);
			}
		}
	}

	folderCache = { key, at: Date.now(), ids: all };
	return all;
}

/**
 * Решает, нужно ли пропустить файл. Возвращает причину или null (обрабатывать).
 * Если storage/folder не переданы (undefined), читает их из directus_files по id.
 */
export async function getSkipReason(
	database: Knex,
	env: Record<string, string | undefined>,
	file: { id: string } & FileLocation
): Promise<SkipReason | null> {
	const cfg = getFileFilterConfig(env);
	if (!isFilterEnabled(cfg)) return null;

	let { storage, folder } = file;
	if (storage === undefined || folder === undefined) {
		const row = await database('directus_files').where('id', file.id).select('storage', 'folder').first();
		if (storage === undefined) storage = row?.storage;
		if (folder === undefined) folder = row?.folder;
	}

	if (cfg.storages && !(storage && cfg.storages.includes(storage))) {
		return 'storage';
	}

	if (cfg.skipFolders.length > 0 && folder) {
		const skipped = await resolveSkippedFolders(database, cfg.skipFolders);
		if (skipped.has(folder)) return 'folder';
	}

	return null;
}
