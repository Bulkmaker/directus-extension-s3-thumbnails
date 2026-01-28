# План реализации: Thumbnails Generator Extension (MVP)

## Цель
Directus hook + endpoint расширение для автоматической генерации миниатюр при загрузке изображений с сохранением в S3.

**Scope MVP:**
- ✅ Hooks: files.upload, files.update, files.delete
- ✅ Endpoints: /thumbnails/regenerate (SSE), /thumbnails/cleanup
- ❌ Watermark — v2 (см. README.md)
- ❌ Сжатие оригиналов — v2 (см. README.md)
- ❌ Telegram бот — v2
- ❌ Отображение миниатюр в окне подробностей медиафайла — v2
- ❌ Интерфейс для перегенерации всех изображений — v2

> **Примечание:** README.md содержит полную спецификацию включая v2 фичи. Этот план — только MVP.

## Архитектура

Структура согласована с README.md:

```
directus-extentions-original/thumbnails-generator/
├── package.json
├── tsconfig.json
├── deploy.sh
├── README.md              # Полная спецификация (v1 + v2)
├── PLAN.md                # Этот файл (MVP план)
└── src/
    ├── index.ts           # Bundle entry point
    ├── hooks/
    │   ├── on-upload.ts   # files.upload + files.update handler
    │   └── on-delete.ts   # files.delete handler
    ├── endpoints/
    │   ├── regenerate.ts  # POST /thumbnails/regenerate
    │   └── cleanup.ts     # DELETE /thumbnails/cleanup
    ├── services/
    │   ├── s3.ts          # S3 операции
    │   └── thumbnail.ts   # Sharp processing
    └── utils/
        ├── config.ts      # Загрузка presets + ENV
        └── mime.ts        # MIME type helpers
```

## Ключевые решения

| Вопрос | Решение |
|--------|---------|
| Presets | Читаем из `directus_settings.storage_asset_presets` через Knex + fallback на пустой массив |
| Форматы | ENV: `THUMBNAILS_FORMATS_{preset}=webp,jpg`, default: `webp` |
| БД для статуса | Не нужна — проверяем существование через S3 HeadObject |
| Sharp | **dependencies** (не peerDependencies) — явная версия для предсказуемости сборки |
| Watermark | v2 — пока не реализуем |

## Риски и митигации

| Риск | Митигация |
|------|-----------|
| **S3 large bucket** — listObjects timeout | Pagination через ContinuationToken, batch size 1000 |
| **S3 rate limiting** | Retry с exponential backoff (3 попытки, 1s→2s→4s) |
| **Concurrency в regenerate** | Параллельность ограничена: `Promise.all` с batch по 5 файлов |
| **Directus schema drift** | Runtime fallback: `settings?.storage_asset_presets ?? []` + warning log |
| **Sharp OOM** | HeadObject.ContentLength > `THUMBNAILS_MAX_FILE_SIZE` → skip |
| **files.update на метаданные** | Регенерация только если изменился `filename_disk` или `type` |
| **Sharp cross-platform** | Сборка в linux CI или `docker exec` внутри контейнера |
| **Ошибка отдельного файла** | Retry 3x с backoff → skip + log → продолжить → список failed в конце |

### Детали реализации

**files.update detection:**
```typescript
// Получить текущие данные из БД
const current = await database('directus_files').where('id', key).first();
const isFileChanged = payload.filename_disk !== current.filename_disk
                   || payload.type !== current.type;
if (!isFileChanged) return; // skip metadata-only updates
```

**S3 cleanup (deleteS3Prefix):**
```typescript
// В s3.ts — уже учтено: listObjects с pagination + batch delete
async function deleteS3Prefix(client, bucket, prefix) {
  let token;
  do {
    const { Contents, NextContinuationToken } = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    if (Contents?.length) {
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: Contents.map(o => ({ Key: o.Key })) }
      }));
    }
    token = NextContinuationToken;
  } while (token);
}
```

**Size check before Sharp:**
```typescript
const maxSize = parseInt(env['THUMBNAILS_MAX_FILE_SIZE'] || '50') * 1024 * 1024;
const head = await s3Client.send(new HeadObjectCommand({ Bucket, Key }));
if (head.ContentLength > maxSize) {
  logger.warn(`[thumbnails] Skipping ${Key}: ${head.ContentLength} bytes > ${maxSize}`);
  return;
}
```

**Retry wrapper:**
```typescript
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i))); // 1s, 2s, 4s
    }
  }
  throw new Error('Unreachable');
}
```

**Error tracking in regenerate:**
```typescript
const failed: Array<{id: string, error: string}> = [];
for (const file of files) {
  try {
    await withRetry(() => generateThumbnails(file));
  } catch (err) {
    failed.push({ id: file.id, error: err.message });
    logger.error(`[thumbnails] Failed ${file.id}: ${err.message}`);
  }
}
// В конце: res.json({ processed, generated, failed });
```

## Порядок реализации (MVP)

### Шаг 1: Scaffold
1. `package.json` — bundle с hook + endpoint (sharp в dependencies)
2. `tsconfig.json` — TypeScript конфиг
3. `deploy.sh` — билд и деплой скрипт (сборка в контейнере через `docker exec`)

### Шаг 2: Utils + Services
4. `src/utils/config.ts` — загрузка presets + ENV с fallback
5. `src/utils/mime.ts` — isImage(), getMimeType(), getExtension()
6. `src/services/s3.ts` — S3 клиент с retry logic и pagination
7. `src/services/thumbnail.ts` — Sharp resize + format conversion

### Шаг 3: Hooks
8. `src/hooks/on-upload.ts` — генерация при загрузке (+ files.update)
9. `src/hooks/on-delete.ts` — удаление при удалении файла
10. `src/index.ts` — bundle entry point (defineHook + defineEndpoint)

### Шаг 4: Endpoints
11. `src/endpoints/regenerate.ts` — POST /thumbnails/regenerate (SSE, batch concurrency)
12. `src/endpoints/cleanup.ts` — DELETE /thumbnails/cleanup (удаление preset папки)

### Шаг 5: Деплой и тест
13. `npm run build && ./deploy.sh`
14. Тест: загрузка изображения → проверка S3
15. Тест: замена файла (update) → старые удалены, новые созданы
16. Тест: удаление → проверка очистки
17. Тест: regenerate с SSE
18. Тест: cleanup preset

## Критичные файлы для изменения

| Файл | Действие |
|------|----------|
| `directus-extentions-original/thumbnails-generator/*` | Создать |
| `docker/env/prod.env` | Добавить THUMBNAILS_* переменные |
| `nuxt/composables/useImageUrl.ts` | Создать (опционально) |

## ENV переменные (MVP)

```bash
# Форматы для каждого preset (через запятую)
# Если не указано — по умолчанию webp
THUMBNAILS_FORMATS_card=webp,jpg
THUMBNAILS_FORMATS_gallery=webp,jpg
THUMBNAILS_FORMATS_thumb=webp

# Лимит размера файла (MB), default: 50
THUMBNAILS_MAX_FILE_SIZE=50

# Verbose logging (для дебага)
THUMBNAILS_VERBOSE=false
```

**v2 (позже):** watermark, сжатие оригиналов

## Зависимости package.json

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.x",
    "sharp": "^0.33.x"
  },
  "devDependencies": {
    "@directus/extensions-sdk": "^11.x",
    "@types/node": "^20.x",
    "typescript": "^5.x"
  }
}
```

> **Примечание:** Sharp в dependencies (не peer) — для предсказуемой сборки. Версия SDK ^11.x согласована с README.

## Верификация

1. **Upload**: загрузка изображения → папки `{preset}/` появляются в S3
2. **Update**: замена файла → старые миниатюры удалены, новые созданы
3. **Delete**: удаление файла → миниатюры удалены из S3
4. **Regenerate**: `curl -X POST /thumbnails/regenerate?sse=true -H "Authorization: Bearer $TOKEN"`
5. **Cleanup**: `curl -X DELETE /thumbnails/cleanup -H "Authorization: Bearer $TOKEN" -d '{"preset":"card"}'`
6. **S3 check**: `aws s3 ls s3://bucket/card/ --endpoint-url $S3_ENDPOINT`
7. **Nuxt**: `getUrl(file, 'card')` возвращает корректный S3 URL

## v2: UI компоненты

### Отображение миниатюр в окне подробностей медиафайла

Добавить панель/секцию в стандартное окно просмотра файла (`directus_files`), которая показывает:
- Сгенерированные миниатюры для текущего файла (по всем presets)
- Статус каждой миниатюры (✓ существует в S3 / ✗ отсутствует)
- Прямые ссылки на миниатюры в S3
- Кнопка "Перегенерировать" для отдельного файла

**Тип расширения:** Panel или Display в bundle

### Интерфейс для перегенерации всех изображений

Модуль в админке Directus для массовой работы с миниатюрами:
- Список всех файлов с превью миниатюр
- Фильтры: по коллекции, по статусу миниатюр, по дате
- Массовая перегенерация выбранных файлов
- Прогресс-бар (использует существующий SSE endpoint)
- Статистика: всего файлов, с миниатюрами, без миниатюр

**Тип расширения:** Module в bundle
