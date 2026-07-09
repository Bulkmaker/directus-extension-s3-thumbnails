# Changelog — directus-extension-s3-thumbnails

Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/) · версии по [SemVer](https://semver.org/lang/ru/).

> **Как читать «Безопасно обновлять»:**
> ✅ да — обратно совместимо, можно обновлять без проверок ·
> ⚠️ с проверкой — поведение/схема могли измениться, протестировать на dev ·
> ❌ breaking — есть несовместимые изменения, читать раздел перед обновлением.

## [0.4.1] — 2026-07-09
### Changed
- Сборка `dist` вынесена в GitHub Actions (авто при пуше в `src`); `dist` коммитится в репозиторий.
- build-инструменты (`@directus/extensions-sdk`, `typescript`, `vue`) — в `devDependencies`.
- Extension подключается к сайтам через список в образе/volume (git-тег), не через Marketplace-кнопку.

**Безопасно обновлять:** ✅ да — изменения только в инфраструктуре сборки, поведение расширения не менялось.

## Более ранняя история
- ci: авто-сборка dist через GitHub Actions (dist в git, без prepare) (2026-07-09)
- chore: prepare-скрипт + build-tools в dependencies (сборка при npm install из git) (2026-07-09)
- feat: detect outdated presets when config changes (2026-01-28)
- feat: add thumbnail count statistics per preset (2026-01-28)
- chore: bump version to 0.4.0 (2026-01-28)
- docs: update documentation for v0.4.0 (2026-01-28)

---
_Правила ведения: при каждом релизе добавляй секцию `## [версия] — дата` с подразделами Added/Changed/Fixed/Removed и строкой **Безопасно обновлять**. Ставь git-тег `v<версия>`._
