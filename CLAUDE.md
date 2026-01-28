# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Directus extension that auto-generates image thumbnails on file upload and stores them in S3 with public access. This removes Directus from the media delivery chain — frontend (Nuxt) fetches images directly from S3.

**Type:** Bundle extension (Hook + Endpoint + Interface + Module)
**Directus:** ^10.0.0 || ^11.0.0

## Commands

```bash
# Build extension
npm run build

# Development with watch
npm run dev

# Build and deploy to Docker container
./deploy.sh
```

The `deploy.sh` script builds and copies output to `docker/directus/extensions/directus-extension-thumbnails-generator/`. После этого нужно закоммитить изменения в docker репозиторий и задеплоить на сервер.

## Architecture

```
src/
├── hooks/
│   ├── index.ts        # Hook registration
│   ├── on-upload.ts    # files.upload + items.update handlers
│   └── on-delete.ts    # items.delete cleanup
├── endpoints/
│   ├── index.ts        # Endpoint registration + /config
│   ├── regenerate.ts   # Regenerate with persistent job state
│   └── cleanup.ts      # Cleanup + orphan detection
├── interface/
│   ├── index.ts        # Interface registration (presentation)
│   └── component.vue   # Vue 3 component for thumbnails panel
├── module/
│   ├── index.ts        # Module registration
│   └── component.vue   # Vue 3 component for thumbnails manager
├── services/
│   ├── s3.ts           # S3 operations with retry logic
│   └── thumbnail.ts    # Directus AssetsService wrapper
└── utils/
    ├── config.ts       # Load presets from Directus settings
    └── mime.ts         # MIME helpers, S3 key builders
```

### Workflow

1. **File Upload** → `files.upload` hook triggered
2. **Generate thumbnails** via internal Directus AssetsService
3. **Upload to S3** with `ACL: public-read`
4. **Frontend** fetches directly from S3/CDN (no Directus proxy)

### Hooks

| Event | Action |
|-------|--------|
| `files.upload` | Generate thumbnails for all presets |
| `filter('items.update')` | Cache old file metadata |
| `action('items.update')` | Delete old + generate new thumbnails |
| `action('items.delete')` | Delete all thumbnails from S3 |

### Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| GET | `/thumbnails/` | Health check |
| GET | `/thumbnails/config` | S3 public config for frontend |
| POST | `/thumbnails/regenerate` | Start regeneration job (returns jobId) |
| GET | `/thumbnails/regenerate/status` | Get job status + SSE |
| DELETE | `/thumbnails/regenerate` | Cancel regeneration |
| DELETE | `/thumbnails/cleanup` | Delete thumbnails for preset (SSE) |
| GET | `/thumbnails/cleanup/status` | Get cleanup status |
| POST | `/thumbnails/cleanup/cancel` | Cancel cleanup |
| GET | `/thumbnails/cleanup/orphans` | Find orphan folders on S3 |
| DELETE | `/thumbnails/cleanup/orphan/:folder` | Delete specific orphan folder |

### Interface (Thumbnails Panel)

Presentation-поле для `directus_files` — показывает сгенерированные миниатюры:
- Превью миниатюры
- Название пресета и размеры (например, `16-9mini 480×270`)
- Кнопка копирования URL
- Прямая ссылка на S3/CDN

**Установка:**
1. Settings → Data Model → directus_files
2. Create Field → Presentation → "Thumbnails Panel"
3. Key: `thumbnails`
4. Save

### Module (Thumbnails Manager)

UI модуль в боковом меню Directus для управления миниатюрами:
- Статистика (изображения, пресеты, ожидаемые миниатюры)
- Регенерация по пресету или всех
- Удаление миниатюр пресета
- Orphan folders detection (папки без соответствующих пресетов)
- Persistent progress (прогресс сохраняется при перезагрузке страницы)
- SSE streaming для real-time обновлений
- Лог операций

## Configuration

### Thumbnail Presets

Configured in **Directus Settings → Files & Storage → Storage Asset Presets:**

```json
[
  { "key": "16-9mini", "width": 480, "height": 270, "fit": "cover", "quality": 80, "format": "jpeg" }
]
```

### Environment Variables

Uses Directus S3 settings (`STORAGE_S3_*`). Extension-specific:

```bash
THUMBNAILS_VERBOSE=false    # Verbose logging
FILES_DOMAIN=files.example.com  # Custom CDN domain (optional)
```

Если `FILES_DOMAIN` указан, URL миниатюр будут `https://files.example.com/{preset}/{file}.jpg`
вместо прямого S3 URL.

### CSP Configuration

Добавьте домен в Content Security Policy (docker-compose.backend.yml):

```yaml
CONTENT_SECURITY_POLICY_DIRECTIVES__IMG_SRC: "'self' data: blob: https://files.example.com ..."
```

## Key Implementation Details

- **Internal API:** Использует Directus AssetsService напрямую (не HTTP запросы)
- **S3 Retry:** Exponential backoff (1s → 2s → 4s, max 3 attempts)
- **ACL:** All thumbnails `public-read`, Cache-Control 1 year
- **Preset Filter:** Skips presets with dimensions > 5000px
- **Format Normalization:** `jpeg` → `jpg`, `auto` → `webp`
- **S3 Key Format:** `{root}/{preset}/{basename}.{format}` or `{preset}/{basename}.{format}`
- **Persistent Jobs:** In-memory job state survives page refresh
- **Orphan Detection:** Compares S3 folders with configured presets

## Job State Architecture

Регенерация и cleanup используют singleton job state в памяти:

```typescript
interface JobState {
  id: string;
  status: 'running' | 'completed' | 'cancelled' | 'error';
  progress: { processed, total, generated, skipped, errors, percent };
  failed: Array<{ id: string; error: string }>;
}

// Global singleton
let currentJob: JobState | null = null;
```

**Преимущества:**
- Клиент может отключиться и переподключиться
- При открытии страницы — автопроверка активной задачи
- Только одна задача одновременно

**Ограничения:**
- При рестарте Directus — состояние теряется
- Не кластеризуется (single-node only)

## Testing After Deploy

```bash
# Check logs
docker logs brusmir.ru-directus --tail 50 -f | grep thumbnails

# Test config endpoint
curl http://localhost:8055/thumbnails/config

# Verify thumbnail exists
curl -I https://files.example.com/16-9mini/{file-id}.jpg

# Check orphan folders
curl http://localhost:8055/thumbnails/cleanup/orphans \
  -H "Authorization: Bearer $TOKEN"
```

## Deployment

### Архитектура репозиториев

```
thumbnails-generator/     ← этот репозиторий (исходники)
        │
   npm run build
   ./deploy.sh
        │
        ▼
docker/                   ← отдельный репозиторий (production)
├── directus/extensions/  ← скомпилированное расширение
└── ...
```

### Процесс деплоя

```bash
# 1. Локально: собрать и скопировать в docker репо
npm run build
./deploy.sh

# 2. Локально: закоммитить в docker репо
cd ../../docker  # путь к docker репозиторию
git add directus/extensions/
git commit -m "chore: update thumbnails-generator extension"
git push origin main

# 3. На сервере: pull и restart
ssh brusmir
cd /var/opt/docker
git pull
cd docker
docker compose -f docker-compose.backend.yml --env-file env/prod.env restart directus
```

### SSH доступ

```bash
ssh brusmir
```

**Структура на сервере:**
- `/var/opt/docker/` — Docker Compose стек (клон docker репозитория)
- `/var/opt/docker/docker/` — docker-compose файлы и extensions

### После деплоя на сервере

```bash
# Перейти в директорию проекта
cd /var/opt/docker/docker

# Перезапустить контейнер
docker compose -f docker-compose.backend.yml --env-file env/prod.env restart directus

# Проверить логи
docker logs brusmir.ru-directus --tail 50 -f | grep thumbnails
```

## S3 Functions (services/s3.ts)

| Function | Purpose |
|----------|---------|
| `createS3Client` | Create S3 client from config |
| `withRetry` | Retry wrapper with exponential backoff |
| `uploadToS3` | Upload buffer with public-read ACL |
| `getFromS3` | Get object as Buffer |
| `existsInS3` | Check if object exists (HEAD) |
| `deleteFromS3` | Delete single object |
| `listS3Objects` | List all objects with prefix |
| `deleteS3Prefix` | Batch delete with progress callback |
| `listS3Folders` | List folder prefixes (CommonPrefixes) |
| `countS3Objects` | Count objects in prefix |

## Platform Note

Расширение использует внутренний Directus AssetsService для трансформации изображений. Нет внешних нативных зависимостей (Sharp и т.д.) — можно компилировать на любой платформе.
