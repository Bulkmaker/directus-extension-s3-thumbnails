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
# Кастомный CDN домен (опционально)
FILES_DOMAIN=files.example.ru

# Verbose логирование
THUMBNAILS_VERBOSE=true
```

### 3. Видео-постеры (опционально, по умолчанию ВЫКЛЮЧЕНО)

Если редактор загрузил видео (mp4 и др., `video/*`) в Directus, расширение может снять кадр и положить его
**вариантами тех же пресетов по тому же пути, что миниатюры картинок**:

```
bucket/
├── 3f1c2a7e-....mp4                 # оригинал видео
├── card/3f1c2a7e-....webp           # постер, пресет "card"
└── hero/3f1c2a7e-....jpg            # постер, пресет "hero" (format: jpeg -> .jpg)
```

Фронт получает постер тем же `imageUrl(file, preset)`, что и для картинок, без новых полей:
`<preset.key>/<filename_disk без расширения>.<format>` (см. `buildThumbnailKey`).

**ENV:**

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `THUMBNAILS_VIDEO_POSTERS` | не задана (выкл.) | `true` — включить постеры для `video/*` |
| `THUMBNAILS_VIDEO_MAX_MB` | `500` | видео крупнее не обрабатываются (warn в лог, без ошибки) |
| `THUMBNAILS_VIDEO_TIMEOUT_SEC` | `60` | таймаут одного запуска ffmpeg (процесс убивается) |
| `THUMBNAILS_FFMPEG_PATH` | не задана | явный путь к ffmpeg (если есть в образе/смонтирован) |
| `THUMBNAILS_FFMPEG_DOWNLOAD` | `true` | разрешить скачать статический ffmpeg, если его нигде нет |
| `THUMBNAILS_FFMPEG_DIR` | `$TMPDIR/directus-s3-thumbnails-ffmpeg` | куда кэшировать скачанный ffmpeg |

**Как выбирается кадр:** ffmpeg берёт кадр на 1-й секунде (`-ss 1`); если кадра там нет (ролик короче секунды) —
первый кадр (`-ss 0`). Кадр (PNG, ширина ограничена 3840 px, поворот из метаданных учитывается) один раз
снимается и прогоняется через ту же пресетную схему, что и картинки: `width/height/fit/quality/withoutEnlargement/format`
(sharp из образа Directus), запись в S3 с `ACL: public-read` (с тем же откатом без ACL, что у картинок),
`Content-Type` по формату и `Cache-Control: public, max-age=31536000`. Уже существующие варианты пропускаются.

**Чтение видео без полной загрузки:** ffmpeg читает оригинал через локальный HTTP-прокси на `127.0.0.1`,
который отдаёт куски объекта из S3 по Range (через S3-клиент процесса Directus) — скачиваются только нужные куски
(moov + начало ролика). Если это не сработало, запасной путь: временный файл в `os.tmpdir()` (лимит
`THUMBNAILS_VIDEO_MAX_MB`, удаляется всегда). Одновременно работает не более 2 ffmpeg.

**Ошибки не ломают загрузку:** любая ошибка (ffmpeg, битый файл, таймаут, S3) пишется в лог
(`[thumbnails] Video poster failed ...`), загрузка файла завершается как обычно, постера просто не будет.

**Удаление:** при удалении файла (картинки или видео) удаляются все его варианты `<preset>/<basename>.*`
(для видео это работает и при выключенной опции — удаляются только реально существующие объекты).

**Регенерация:** «Regenerate» в модуле и `POST /thumbnails/regenerate` при включённой опции обрабатывают и видео
(в т.ч. уже загруженные ролики; `force`, `preset`, `fileIds` работают как для картинок). `GET /thumbnails/stats`
добавляет поле `totalVideos`, `totalImages` = картинки + видео при включённой опции.

**ffmpeg и установка (важно для Dokploy):**
- Образ `directus/directus` — alpine/musl, `USER=node`, ffmpeg в нём нет, `apk add` недоступен.
- Command-обёртка из `install-extensions.sh` копирует в `/directus/extensions` только `package.json` + `dist` расширения;
  npm-зависимости (в т.ч. `ffmpeg-static` с его postinstall-загрузкой бинаря) остаются в сборочной папке и **не доезжают**
  до рантайма. Поэтому `ffmpeg-static` как зависимость здесь не работает, и расширение само скачивает тот же самый
  бинарь: релиз `eugeneware/ffmpeg-static` `b6.1.1` (GitHub Releases), `linux-x64`/`linux-arm64` (и `darwin-arm64` для
  локальной разработки), **с проверкой sha256** (хэши зашиты в код), в `THUMBNAILS_FFMPEG_DIR` (по умолчанию `/tmp`, при
  пересоздании контейнера скачивается заново, ≈25 МБ, ~1-2 с). Бинарь статический и проверен на alpine/musl (arm64 и x64).
- Нужен исходящий доступ контейнера к `github.com` при первом видео после старта. Чтобы не зависеть от сети: смонтируйте
  ffmpeg в контейнер и задайте `THUMBNAILS_FFMPEG_PATH`, либо `THUMBNAILS_FFMPEG_DOWNLOAD=false`.
- Порядок поиска: `THUMBNAILS_FFMPEG_PATH` -> `ffmpeg-static` (если установлен рядом) -> кэш скачивания -> `ffmpeg` из PATH -> скачивание.
- Лицензия бинаря ffmpeg-static: GPL (отдельный исполняемый файл, расширение запускает его как процесс).
- sharp для кадра берётся из образа Directus (резолвится через `@directus/api`), в расширение не бандлится.

**Ограничения:** постер = один статичный кадр; формат ролика определяется ffmpeg (mp4/mov/webm/mkv и др.);
видео с moov-атомом в конце читаются с большим числом Range-запросов (быстрее с `-movflags +faststart`);
первая обработка после старта контейнера включает скачивание ffmpeg.

### 4. CSP Configuration

Добавьте CDN домен в Content Security Policy (docker-compose.backend.yml):

```yaml
CONTENT_SECURITY_POLICY_DIRECTIVES__IMG_SRC: "'self' data: blob: https://files.example.ru ..."
```

---

## Архитектура

### Генерация через внутренний Directus AssetsService

Расширение использует внутренний Directus AssetsService напрямую (не HTTP запросы):

```
1. Hook: files.upload срабатывает
2. AssetsService.getAsset(id, transformationParams)
3. Directus генерирует миниатюру через Sharp
4. Результат загружается в S3 с ACL: public-read
```

Это гарантирует совместимость версий Sharp с Directus и работает внутри процесса без сетевых вызовов.

### Hooks

| Hook | Событие | Действие |
|------|---------|----------|
| `files.upload` | Новый файл | Генерация миниатюр (картинки; видео-постеры при `THUMBNAILS_VIDEO_POSTERS=true`) |
| `filter('files.delete')` + `files.delete` | Удаление файла | Чистка вариантов в S3 (картинки и видео) |
| `filter('items.update')` | Замена файла | Кэш старого имени |
| `action('items.update')` | После замены | Удаление старых + генерация новых |
| `action('items.delete')` | (legacy) | Оставлено для совместимости |

### Endpoints

| Метод | URL | Назначение |
|-------|-----|------------|
| GET | `/thumbnails/` | Health check |
| GET | `/thumbnails/config` | S3/CDN config для фронтенда |
| POST | `/thumbnails/regenerate` | Запуск регенерации (возвращает jobId) |
| GET | `/thumbnails/regenerate/status` | Статус задачи + SSE |
| DELETE | `/thumbnails/regenerate` | Отмена регенерации |
| DELETE | `/thumbnails/cleanup` | Удаление пресета (с SSE прогрессом) |
| GET | `/thumbnails/cleanup/status` | Статус cleanup задачи |
| POST | `/thumbnails/cleanup/cancel` | Отмена cleanup |
| GET | `/thumbnails/cleanup/orphans` | Поиск orphan-папок на S3 |
| DELETE | `/thumbnails/cleanup/orphan/:folder` | Удаление orphan-папки |

### Interface (Thumbnails Panel)

Presentation-поле для `directus_files` — показывает сгенерированные миниатюры прямо в форме редактирования файла:
- Превью миниатюры
- Название пресета и размеры
- Кнопка копирования URL
- Прямая ссылка на S3/CDN

**Установка:**
1. Settings → Data Model → directus_files
2. Create Field → Presentation → "Thumbnails Panel"
3. Key: `thumbnails`
4. Save

### Module (Thumbnails Manager)

Полноценный UI для управления миниатюрами в боковом меню админки:

**Статистика:**
- Количество изображений в библиотеке
- Количество пресетов
- Ожидаемое количество миниатюр

**Регенерация:**
- Список пресетов с кнопкой регенерации для каждого
- Массовая регенерация с опцией "Force"
- Прогресс-бар с SSE стримингом в реальном времени
- **Persistent progress** — прогресс сохраняется при перезагрузке страницы

**Удаление:**
- Выбор пресета для удаления
- Прогресс-бар удаления
- Подтверждение перед удалением

**Orphan Folders (Сироты):**
- Сканирование S3 на папки, не соответствующие текущим пресетам
- Показ количества файлов в каждой orphan-папке
- Удаление orphan-папок одним кликом
- Полезно после переименования/удаления пресетов

**Лог операций:**
- История всех действий в реальном времени
- Цветовая индикация (info/success/error)

После деплоя расширения модуль автоматически появится в боковом меню Directus.

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

Запуск массовой регенерации миниатюр. Возвращает `jobId` сразу, обработка идёт в фоне.

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

**Ответ:**
```json
{"jobId": "abc-123", "status": "started", "total": 1000}
```

### GET /thumbnails/regenerate/status

Получение статуса текущей задачи. Поддерживает SSE для real-time обновлений.

```bash
# JSON
curl https://cms.example.ru/thumbnails/regenerate/status \
  -H "Authorization: Bearer $TOKEN"

# SSE
curl https://cms.example.ru/thumbnails/regenerate/status?sse=true \
  -H "Authorization: Bearer $TOKEN"
```

**Ответ:**
```json
{
  "id": "abc-123",
  "status": "running",
  "processed": 500,
  "total": 1000,
  "generated": 450,
  "skipped": 50,
  "errors": 0,
  "percent": 50
}
```

### DELETE /thumbnails/regenerate

Отмена текущей задачи регенерации.

```bash
curl -X DELETE https://cms.example.ru/thumbnails/regenerate \
  -H "Authorization: Bearer $TOKEN"
```

### DELETE /thumbnails/cleanup

Удаление всех миниатюр пресета. Поддерживает SSE для прогресса.

```bash
curl -X DELETE https://cms.example.ru/thumbnails/cleanup \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"preset": "old-preset", "sse": true}'
```

### GET /thumbnails/cleanup/orphans

Поиск папок на S3, которые не соответствуют текущим пресетам.

```bash
curl https://cms.example.ru/thumbnails/cleanup/orphans \
  -H "Authorization: Bearer $TOKEN"
```

**Ответ:**
```json
{
  "presets": ["16-9mini", "card"],
  "s3Folders": ["16-9mini", "card", "old-preset"],
  "orphans": [{"folder": "old-preset", "count": 150}]
}
```

### DELETE /thumbnails/cleanup/orphan/:folder

Удаление конкретной orphan-папки.

```bash
curl -X DELETE https://cms.example.ru/thumbnails/cleanup/orphan/old-preset \
  -H "Authorization: Bearer $TOKEN"
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
# {"jobId": "...", "status": "started", "total": 1}
```

---

## Troubleshooting

### 403 при доступе к миниатюре

**Причина:** S3 bucket не настроен на публичный доступ.

**Решение:** Включить публичный доступ в настройках S3.

### 401 Unauthorized при API вызовах

**Причина:** Нет авторизации или не админ.

**Решение:** Используйте токен с правами администратора.

### 503 Service Unavailable

**Причина:** Пресет с огромными размерами (9999x9999).

**Решение:** Пресеты > 5000px автоматически игнорируются.

### Миниатюры не генерируются

**Проверить:**
1. `STORAGE_S3_DRIVER=s3` в ENV
2. Логи: `docker logs directus | grep thumbnails`
3. Пресеты настроены в Settings → Files & Storage

### Orphan scan не находит папки

**Проверить:**
1. Логи: `docker logs directus | grep "Scanning S3"`
2. Убедиться что `STORAGE_S3_ROOT` корректен
3. Проверить права доступа к S3 bucket (ListBucket)

---

## Статус реализации

### v0.1.0 (Core)
- [x] Hook: files.upload
- [x] Hook: items.update (с filter для старого имени)
- [x] Hook: items.delete
- [x] Endpoint: regenerate
- [x] Endpoint: cleanup
- [x] ACL: public-read для миниатюр

### v0.2.0 (Interface)
- [x] Thumbnails Panel — презентационное поле
- [x] Поддержка FILES_DOMAIN для кастомного CDN
- [x] Endpoint: config (для фронтенда)

### v0.3.0 (Module)
- [x] Thumbnails Manager Module — полный UI
- [x] SSE стриминг прогресса
- [x] Отмена операций

### v0.4.0 (Current)
- [x] Persistent job state — прогресс переживает перезагрузку
- [x] Orphan folders detection — поиск и удаление сирот
- [x] Cleanup progress bar — прогресс удаления

### v0.5.0
- [x] Видео-постеры (ffmpeg, `THUMBNAILS_VIDEO_POSTERS`) — варианты тех же пресетов по тому же пути
- [x] Удаление вариантов при удалении файла (события `files.delete`)

### Planned
- [ ] Watermark
- [ ] Сжатие оригиналов
- [ ] Bulk delete по фильтру
