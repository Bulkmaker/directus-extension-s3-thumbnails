# directus-extension-s3-thumbnails

Публичный репозиторий. Не добавлять в код, доки и инструкции приватную инфраструктуру: ssh-алиасы, серверные и локальные пути, имена контейнеров, секреты.

## Назначение и стек

Расширение Directus: при загрузке файла генерирует миниатюры по пресетам и кладёт их в S3 с публичным доступом. Фронтенд берёт картинки напрямую из S3/CDN, Directus в раздаче медиа не участвует.

- Тип: bundle (hook + endpoint + interface + module), TypeScript, Vue 3 для UI.
- Directus: `^10.0.0 || ^11.0.0`. Рантайм-зависимость: `@aws-sdk/client-s3`.
- Нативных зависимостей нет: изображения обрабатывает внутренний AssetsService Directus, sharp берётся из образа Directus.

## Команды

```bash
npm run build   # directus-extension build --no-minify
npm run dev     # сборка в watch-режиме
npm test        # vitest; тесты с реальным ffmpeg требуют FFMPEG_TEST_BIN или ffmpeg в PATH
```

Сборка только с `--no-minify` (минифицированная отдавала устаревший dist из кэша build-тула).

## Структура src/

- `hooks/`: `index.ts` (регистрация), `on-upload.ts` (`files.upload`, `items.update`), `on-delete.ts` (`files.delete`: filter для предзагрузки метаданных + action).
- `endpoints/`: `index.ts` (`/`, `/config`, `/stats`), `regenerate.ts`, `cleanup.ts`.
- `services/`: `s3.ts` (операции S3 с retry), `thumbnail.ts` (обёртка AssetsService), `image-pipeline.ts` (кадр через пресет), `preset-sync.ts` (хэш пресетов в `_config.json` на S3), `ffmpeg.ts`, `range-proxy.ts`, `video-poster.ts` (видео-постеры).
- `utils/`: `config.ts` (пресеты из Directus Settings), `mime.ts` (MIME, построение S3-ключей).
- `interface/` и `module/`: Vue-компоненты панели миниатюр и менеджера в боковом меню.

## Поведение

| Событие | Действие |
|---|---|
| `files.upload` | Миниатюры по всем пресетам (видео: постер, если включено) |
| `items.update` (filter + action) | Удалить старые варианты, сгенерировать новые |
| `files.delete` (filter + action) | Удалить все варианты файла из S3, только объекты `<preset>/<basename>.*` |

Endpoints (префикс `/thumbnails`): `GET /` health, `GET /config` публичный S3-конфиг, `GET /stats`, `POST|GET|DELETE /regenerate` (запуск, статус и SSE, отмена), `DELETE /cleanup` (удаление пресета, SSE), `GET /cleanup/status`, `POST /cleanup/cancel`, `GET /cleanup/orphans`, `DELETE /cleanup/orphan/:folder`.

## Ключевые правила реализации

- Пресеты берутся из Directus Settings (Storage Asset Presets). Пресеты с шириной или высотой от 5000 px пропускаются.
- Формат: `jpeg` в `jpg`, `auto` в `webp`. Ключ S3: `{root}/{preset}/{basename}.{format}` или `{preset}/{basename}.{format}`.
- Загрузка в S3: `ACL: public-read`, Cache-Control на год. Если бэкенд запрещает per-object ACL, запись не должна падать.
- S3-запросы через retry с exponential backoff (1s, 2s, 4s, до 3 попыток).
- Регенерация и cleanup держат singleton-состояние задачи в памяти: переживает перезагрузку страницы, теряется при рестарте Directus, не кластеризуется (single-node), одна задача одновременно.
- Видео-постеры: опция `THUMBNAILS_VIDEO_POSTERS=true`, по умолчанию выключена. Варианты пишутся в те же ключи, что у картинок. Ошибки ffmpeg и S3 только логируются, загрузка файла не ломается.
- Конфигурация: S3 берётся из `STORAGE_S3_*` Directus; свои ENV (`THUMBNAILS_*`, `FILES_DOMAIN`) и установка ffmpeg описаны в README (разделы про ENV и «Видео-постеры»), здесь не дублировать.

## Релиз и деплой

- `dist/` коммитится в репозиторий CI, руками не править. `.github/workflows/build.yml`: на push в main (изменения в `src/**`, `package.json`, `tsconfig.json`) прогоняет тесты и пересобирает dist. `release.yml`: на тег `vX.Y.Z` пересобирает dist от свежего main и переставляет тег на dist-коммит.
- Потребители ставят расширение из GitHub-tarball по тегу. Обновление: поднять версию в `package.json`, дописать CHANGELOG.md, запушить, поставить тег `vX.Y.Z`.
- `deploy.sh` копирует сборку в соседний локальный docker-репозиторий владельца; логику деплоя на серверы в этот репозиторий не добавлять.

## Git и документация

- Не коммитить и не пушить без явной просьбы владельца.
- README.md для пользователей, CHANGELOG.md по Keep a Changelog. PLAN.md и AUDIT.md исторические, не переписывать.
- После задачи запись в CHANGELOG.md через skill `changelog`.
