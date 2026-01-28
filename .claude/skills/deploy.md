# /deploy — Деплой расширения на сервер

Выполнить полный цикл деплоя расширения thumbnails-generator.

## Шаги

1. **Сборка расширения**
   ```bash
   npm run build
   ```

2. **Копирование в docker репо**
   ```bash
   ./deploy.sh
   ```

3. **Коммит в docker репозиторий**
   ```bash
   cd /Users/misa/Documents/GitHub/NewStarter/docker
   git add directus/extensions/directus-extension-thumbnails-generator/
   git status
   ```

   Если есть изменения — создать коммит:
   ```bash
   git commit -m "chore: update thumbnails-generator extension"
   git push origin main
   ```

4. **Деплой на сервер** (спросить пользователя)
   ```bash
   ssh brusmir "cd /var/opt/docker && git pull && docker compose -f docker-compose.backend.yml restart directus"
   ```

5. **Проверка логов**
   ```bash
   ssh brusmir "docker logs brusmir-directus --tail 20 | grep thumbnails"
   ```

## Параметры

- Без параметров: полный цикл (build → deploy.sh → commit → push)
- `--no-push`: только локальная сборка без push
- `--server`: также выполнить деплой на сервер

## Важно

- Перед деплоем убедись что все изменения в thumbnails-generator закоммичены
- Docker репозиторий: `/Users/misa/Documents/GitHub/NewStarter/docker`
- Сервер: `ssh brusmir`, путь `/var/opt/docker`
