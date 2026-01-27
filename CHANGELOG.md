# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-alpha.1] - 2026-01-28

### Added

- **Hook: files.upload** — автоматическая генерация миниатюр при загрузке изображений
- **Hook: items.update** — перегенерация при замене файла (с удалением старых миниатюр)
- **Hook: items.delete** — удаление миниатюр при удалении файла
- **Endpoint: POST /thumbnails/regenerate** — массовая регенерация с поддержкой SSE
- **Endpoint: DELETE /thumbnails/cleanup** — удаление всех миниатюр конкретного пресета
- **ACL: public-read** — миниатюры доступны напрямую с S3 без Directus
- Использование Directus Transform API (без bundled Sharp)
- Фильтрация пресетов > 5000px (защита от timeout)
- Retry с exponential backoff для S3 операций
- Пагинация в regenerate endpoint (защита от OOM)

### Architecture

- Миниатюры загружаются в S3 с `ACL: public-read`
- Формат файла определяется `preset.format` из Directus Settings
- Структура S3: `{preset}/{filename}.{format}`

### Known Limitations

- `ADMIN_ACCESS_TOKEN` требуется для приватных файлов
- Hardcoded `localhost:8055` для Transform API
- 500ms delay перед генерацией (race condition mitigation)

### Not Implemented (v2)

- Watermark
- Сжатие оригиналов
- Множественные форматы на пресет
