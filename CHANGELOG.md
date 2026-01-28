# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-01-28

### Added
- **Thumbnails Panel Interface** — презентационное поле для отображения миниатюр в форме редактирования файла
  - Превью миниатюры
  - Название пресета и размеры
  - Кнопка копирования URL
  - Ссылка на S3
- **Endpoint `/thumbnails/config`** — возвращает публичную часть S3 конфигурации для фронтенда
- **Поддержка `FILES_DOMAIN`** — кастомный CDN домен вместо прямого S3 URL

### Changed
- Обновлена структура bundle: добавлен entry для interface

### Configuration
Для использования кастомного домена добавьте в env:
```env
FILES_DOMAIN=files.example.com
```

Добавьте домен в CSP (docker-compose.backend.yml):
```yaml
CONTENT_SECURITY_POLICY_DIRECTIVES__IMG_SRC: "'self' data: blob: https://files.example.com ..."
```

## [0.1.0] - 2026-01-28

### Added
- **Hook `files.upload`** — автоматическая генерация миниатюр при загрузке изображений
- **Hook `items.update`** — перегенерация при замене файла
- **Hook `items.delete`** — удаление миниатюр из S3 при удалении файла
- **Endpoint `/thumbnails/regenerate`** — массовая перегенерация с SSE прогрессом
- **Endpoint `/thumbnails/cleanup`** — удаление миниатюр для конкретного пресета

### Technical
- Использует внутренний Directus AssetsService для трансформации
- S3 upload с retry логикой (exponential backoff)
- Все миниатюры с `public-read` ACL и Cache-Control 1 год
