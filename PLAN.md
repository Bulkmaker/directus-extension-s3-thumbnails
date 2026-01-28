# План реализации: Thumbnails Generator Extension

## Статус

### v1 (MVP) — ✅ DONE
- ✅ Hooks: files.upload, files.update, files.delete
- ✅ Endpoints: /thumbnails/regenerate (SSE), /thumbnails/cleanup, /thumbnails/config
- ✅ Использование внутреннего Directus AssetsService (не Sharp напрямую)

### v1.1 (Interface) — ✅ DONE
- ✅ **Thumbnails Panel** — презентационное поле в форме файла
  - Превью миниатюры
  - Название пресета и размеры
  - Кнопка копирования URL
  - Прямая ссылка на S3/CDN
- ✅ Поддержка `FILES_DOMAIN` для кастомного CDN домена

### v2 (Planned)
- ❌ Watermark — наложение водяного знака
- ❌ Сжатие оригиналов
- ❌ Telegram бот уведомления
- ❌ Module для массовой перегенерации с UI

## Архитектура

```
directus-extentions-original/thumbnails-generator/
├── package.json
├── tsconfig.json
├── deploy.sh
├── CHANGELOG.md
├── CLAUDE.md
├── PLAN.md
└── src/
    ├── hooks/
    │   ├── index.ts        # Hook registration + context
    │   ├── on-upload.ts    # files.upload + items.update handler
    │   └── on-delete.ts    # items.delete handler
    ├── endpoints/
    │   ├── index.ts        # Endpoint registration + /config
    │   ├── regenerate.ts   # POST /thumbnails/regenerate (SSE)
    │   └── cleanup.ts      # DELETE /thumbnails/cleanup
    ├── interface/
    │   ├── index.ts        # Interface registration (presentation)
    │   └── component.vue   # Vue 3 component
    ├── services/
    │   ├── s3.ts           # S3 operations with retry logic
    │   └── thumbnail.ts    # Directus AssetsService wrapper
    └── utils/
        ├── config.ts       # Load presets from Directus settings
        └── mime.ts         # MIME type helpers
```

## Ключевые решения

| Вопрос | Решение |
|--------|---------|
| Presets | Читаем из `directus_settings.storage_asset_presets` через Knex |
| Image processing | Внутренний Directus AssetsService (не Sharp напрямую) |
| S3 URL | `FILES_DOMAIN` env → CDN URL, иначе конструируем из S3 config |
| Interface type | Alias/Presentation — не создаёт колонку в БД |
| CSP | Требуется добавить домен в IMG_SRC |

## ENV переменные

```bash
# Стандартные Directus S3 переменные
STORAGE_S3_DRIVER=s3
STORAGE_S3_KEY=...
STORAGE_S3_SECRET=...
STORAGE_S3_BUCKET=...
STORAGE_S3_REGION=...
STORAGE_S3_ENDPOINT=...

# Extension-specific
FILES_DOMAIN=files.example.com  # Кастомный CDN домен (опционально)
THUMBNAILS_VERBOSE=false        # Verbose logging
```

## CSP Configuration

Если используется кастомный домен, добавить в docker-compose.backend.yml:

```yaml
CONTENT_SECURITY_POLICY_DIRECTIVES__IMG_SRC: "'self' data: blob: https://files.example.com ..."
```

## Установка Interface

1. Задеплоить расширение
2. Settings → Data Model → directus_files
3. Create Field → Presentation → "Thumbnails Panel"
4. Key: `thumbnails`
5. Save

## API Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| GET | `/thumbnails/` | Health check |
| GET | `/thumbnails/config` | S3/CDN config для фронтенда |
| POST | `/thumbnails/regenerate` | Массовая перегенерация (SSE) |
| DELETE | `/thumbnails/cleanup` | Удаление миниатюр для пресета |

## v2: Планируемые фичи

### Module для массовой работы с миниатюрами

Модуль в админке Directus:
- Список всех файлов с превью миниатюр
- Фильтры: по коллекции, по статусу миниатюр, по дате
- Массовая перегенерация выбранных файлов
- Прогресс-бар (использует существующий SSE endpoint)
- Статистика: всего файлов, с миниатюрами, без миниатюр

### Watermark

Наложение водяного знака на миниатюры:
- Конфигурация через ENV или Directus settings
- Позиция, размер, прозрачность
- Разные watermarks для разных presets
