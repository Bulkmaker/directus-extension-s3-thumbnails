# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Directus extension that auto-generates image thumbnails on file upload and stores them in S3 with public access. This removes Directus from the media delivery chain — frontend (Nuxt) fetches images directly from S3.

**Type:** Bundle extension (Hook + Endpoint + Interface)
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
│   ├── regenerate.ts   # POST /thumbnails/regenerate (SSE progress)
│   └── cleanup.ts      # DELETE /thumbnails/cleanup
├── interface/
│   ├── index.ts        # Interface registration (presentation)
│   └── component.vue   # Vue 3 component for thumbnails panel
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
| POST | `/thumbnails/regenerate` | Batch regenerate with SSE progress |
| DELETE | `/thumbnails/cleanup` | Delete thumbnails for a preset |

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
- **S3 Key Format:** `{preset}/{basename}.{format}`

## Testing After Deploy

```bash
# Check logs
docker logs brusmir.ru-directus --tail 50 -f | grep thumbnails

# Test config endpoint
curl http://localhost:8055/thumbnails/config

# Verify thumbnail exists
curl -I https://files.example.com/16-9mini/{file-id}.jpg
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
docker compose -f docker-compose.backend.yml --env-file env/prod.env up -d directus
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

# Пересоздать контейнер (чтобы подхватить новые env)
docker compose -f docker-compose.backend.yml --env-file env/prod.env up -d directus

# Проверить логи
docker logs brusmir.ru-directus --tail 50 -f | grep thumbnails
```

## Platform Note

Расширение использует внутренний Directus AssetsService для трансформации изображений. Нет внешних нативных зависимостей (Sharp и т.д.) — можно компилировать на любой платформе.
