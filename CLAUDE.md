# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Directus extension that auto-generates image thumbnails on file upload and stores them in S3 with public access. This removes Directus from the media delivery chain — frontend (Nuxt) fetches images directly from S3.

**Type:** Bundle extension (Hook + Endpoint)
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
│   ├── index.ts        # Endpoint registration
│   ├── regenerate.ts   # POST /thumbnails/regenerate (SSE progress)
│   └── cleanup.ts      # DELETE /thumbnails/cleanup
├── services/
│   ├── s3.ts           # S3 operations with retry logic
│   └── thumbnail.ts    # Sharp image processing
└── utils/
    ├── config.ts       # Load presets from Directus settings
    └── mime.ts         # MIME helpers, S3 key builders
```

### Workflow

1. **File Upload** → `files.upload` hook triggered
2. **Generate thumbnails** via Directus Transform API (`GET /assets/{id}?width=...`)
3. **Upload to S3** with `ACL: public-read`
4. **Frontend** fetches directly from S3 (no Directus proxy)

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
| POST | `/thumbnails/regenerate` | Batch regenerate with SSE progress |
| DELETE | `/thumbnails/cleanup` | Delete thumbnails for a preset |

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
ADMIN_ACCESS_TOKEN=...      # Required for private files
```

## Key Implementation Details

- **S3 Retry:** Exponential backoff (1s → 2s → 4s, max 3 attempts)
- **ACL:** All thumbnails `public-read`, Cache-Control 1 year
- **Preset Filter:** Skips presets with dimensions > 5000px
- **Format Normalization:** `jpeg` → `jpg`, `auto` → `webp`
- **S3 Key Format:** `{preset}/{basename}.{format}`

## Testing After Deploy

```bash
# Check logs
docker logs directus | grep thumbnails

# Verify S3 structure
aws s3 ls s3://bucket/ --recursive

# Test regenerate endpoint
curl -X POST https://cms.example.com/thumbnails/regenerate \
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
cd ../../../docker  # путь к docker репозиторию
git add directus/extensions/
git commit -m "chore: update thumbnails-generator extension"
git push origin main

# 3. На сервере: pull и restart
ssh brusmir
cd /var/opt/docker
git pull
docker compose -f docker-compose.backend.yml restart directus
```

### SSH доступ

```bash
ssh brusmir
```

**Структура на сервере:**
- `/var/opt/docker/` — Docker Compose стек (клон docker репозитория)

### После деплоя на сервере

```bash
# Перейти в директорию проекта
cd /var/opt/docker

# Перезапустить Directus
docker compose -f docker-compose.backend.yml restart directus

# Проверить логи
docker logs brusmir-directus --tail 50 -f | grep thumbnails
```

## Platform Note

Расширение не использует Sharp напрямую — миниатюры генерируются через Directus Transform API. Поэтому нет нативных зависимостей и можно компилировать на любой платформе.
