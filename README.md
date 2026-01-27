# Directus Thumbnails Generator Extension

## Цель

**Убрать Directus из цепочки отдачи медиафайлов.**

Расширение автоматически генерирует миниатюры при загрузке изображений и сохраняет их в S3 с публичным доступом. Статический сайт (Nuxt) загружает изображения напрямую с S3, без участия Directus.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Directus  │────▶│     S3      │◀────│    Nuxt     │
│  (генерация)│     │  (хранение) │     │  (отдача)   │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
   загрузка           публичный            прямой
   файла              доступ               запрос
```

**Важно:** Миниатюры загружаются с `ACL: public-read` и доступны по прямому URL без авторизации.

---

## Требования к S3

### Публичный доступ обязателен

S3 bucket должен разрешать публичное чтение файлов:

**Beget S3:** Включить "Публичный доступ" в настройках bucket

**AWS S3:** Bucket policy для публичного чтения:
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::your-bucket/*"
  }]
}
```

### Публичный домен

Настроить DNS для прямого доступа к файлам:

```
files.example.ru → S3 bucket
```

Пример: `https://files.newbrusmir.ru/16-9mini/abc123.jpg`

---

## Структура S3

```
bucket/
├── abc123.jpg              # оригинал (загружен Directus)
├── 16-9mini/
│   └── abc123.jpg          # миниатюра 480x270
├── card/
│   └── abc123.webp         # миниатюра 800x600
└── gallery/
    └── abc123.webp         # миниатюра 1200px
```

**URL паттерн:**
```
Оригинал:   https://files.example.ru/abc123.jpg
Миниатюра:  https://files.example.ru/16-9mini/abc123.jpg
```

---

## Конфигурация

### 1. Directus Settings

Settings → Files & Storage → Storage Asset Presets:

```json
[
  { "key": "16-9mini", "width": 480, "height": 270, "fit": "cover", "quality": 80, "format": "jpeg" },
  { "key": "card", "width": 800, "height": 600, "fit": "cover", "quality": 80, "format": "webp" }
]
```

**Важно:**
- `format` определяет выходной формат (jpeg, webp, png, avif)
- `format: "auto"` или пустой → webp по умолчанию
- Пресеты с размерами > 5000px игнорируются

### 2. ENV переменные

```bash
# Обязательно для приватных файлов
ADMIN_ACCESS_TOKEN=your-static-token

# Опционально: verbose логирование
THUMBNAILS_VERBOSE=true
```

---

## Архитектура

### Генерация через Directus Transform API

Расширение НЕ использует Sharp напрямую. Вместо этого оно вызывает встроенный Transform API Directus:

```
1. Hook: files.upload срабатывает
2. GET /assets/{id}?width=480&height=270&format=jpeg
3. Directus генерирует миниатюру через Sharp
4. Результат загружается в S3 с ACL: public-read
```

Это гарантирует совместимость версий Sharp с Directus.

### Hooks

| Hook | Событие | Действие |
|------|---------|----------|
| `files.upload` | Новый файл | Генерация миниатюр |
| `filter('items.update')` | Замена файла | Кэш старого имени |
| `action('items.update')` | После замены | Удаление старых + генерация новых |
| `action('items.delete')` | Удаление | Удаление миниатюр из S3 |

### Endpoints

| Метод | URL | Назначение |
|-------|-----|------------|
| POST | `/thumbnails/regenerate` | Массовая регенерация |
| DELETE | `/thumbnails/cleanup` | Удаление пресета |

---

## Использование

### Nuxt composable

```typescript
// composables/useImageUrl.ts
export function useImageUrl() {
  const config = useRuntimeConfig()

  // config.public.filesUrl = "https://files.newbrusmir.ru"

  function getUrl(
    file: { filename_disk: string } | null,
    preset: string = '16-9mini'
  ): string {
    if (!file?.filename_disk) return '/placeholder.jpg'

    const basename = file.filename_disk.replace(/\.[^.]+$/, '')
    // Формат определяется preset.format в Directus Settings
    return `${config.public.filesUrl}/${preset}/${basename}.jpg`
  }

  return { getUrl }
}
```

### Компонент

```vue
<template>
  <img :src="getUrl(project.image, '16-9mini')" :alt="project.title">
</template>
```

---

## API

### POST /thumbnails/regenerate

Массовая регенерация миниатюр.

```bash
curl -X POST https://cms.example.ru/thumbnails/regenerate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"preset": "16-9mini", "force": true}'
```

**Параметры:**
- `preset` — конкретный пресет (опционально)
- `force` — пересоздать существующие (default: false)
- `fileIds` — конкретные файлы (опционально)
- `sse` — Server-Sent Events для прогресса

### DELETE /thumbnails/cleanup

Удаление всех миниатюр пресета.

```bash
curl -X DELETE https://cms.example.ru/thumbnails/cleanup \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"preset": "old-preset"}'
```

---

## Проверка работоспособности

### 1. Загрузка файла

```bash
# Загрузить изображение в Directus
# Проверить логи:
docker logs directus | grep thumbnails
# [thumbnails] files.upload triggered: key=abc123
# [thumbnails] Processing upload: abc123.png
# [thumbnails] Completed: abc123.png (generated: 1, skipped: 0)
```

### 2. Проверка S3

```bash
# Прямой доступ к миниатюре (должен вернуть 200)
curl -I https://files.example.ru/16-9mini/abc123.jpg
```

### 3. Регенерация

```bash
# Проверка существующей миниатюры (skipped: 1 = уже существует)
curl -X POST .../thumbnails/regenerate \
  -d '{"fileIds":["abc123"]}' | jq
# {"processed": 1, "generated": 0, "skipped": 1}
```

---

## Troubleshooting

### 403 при доступе к миниатюре

**Причина:** S3 bucket не настроен на публичный доступ.

**Решение:** Включить публичный доступ в настройках S3.

### 401 Unauthorized в логах

**Причина:** `ADMIN_ACCESS_TOKEN` не установлен для приватных файлов.

**Решение:** Создать статический токен в Directus и добавить в ENV.

### 503 Service Unavailable

**Причина:** Пресет с огромными размерами (9999x9999).

**Решение:** Пресеты > 5000px автоматически игнорируются.

### Миниатюры не генерируются

**Проверить:**
1. `STORAGE_S3_DRIVER=s3` в ENV
2. Логи: `docker logs directus | grep thumbnails`
3. Пресеты настроены в Settings → Files & Storage

---

## Статус реализации

- [x] Hook: files.upload
- [x] Hook: items.update (с filter для старого имени)
- [x] Hook: items.delete
- [x] Endpoint: regenerate (с пагинацией и SSE)
- [x] Endpoint: cleanup
- [x] ACL: public-read для миниатюр
- [ ] Watermark (v2)
- [ ] Сжатие оригиналов (v2)
