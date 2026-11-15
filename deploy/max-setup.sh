#!/usr/bin/env bash
# Подключение бота Max к уже установленной платформе.
# Запуск на сервере: cd /opt/challenge-platform && git pull && sudo bash deploy/max-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=apps/server/.env
[ -f "$ENV" ] || { echo "Не найден $ENV: сначала установите платформу (deploy/install.sh)"; exit 1; }

read -r -p "Ник бота в Max без @ (из ссылки max.ru/<ник>): " MAX_BOT_USERNAME </dev/tty
MAX_BOT_USERNAME="${MAX_BOT_USERNAME#@}"
MAX_BOT_USERNAME="${MAX_BOT_USERNAME##*/}"
MAX_BOT_TOKEN=""
until [ ${#MAX_BOT_TOKEN} -ge 20 ]; do
  [ -n "$MAX_BOT_TOKEN" ] && echo "Слишком короткий токен. Скопируйте его целиком и попробуйте ещё раз."
  read -r -s -p "Токен бота Max (при вставке ничего не видно, это нормально): " MAX_BOT_TOKEN </dev/tty; echo
  MAX_BOT_TOKEN="$(printf '%s' "$MAX_BOT_TOKEN" | tr -d '[:space:]')"
done

set_var() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV"; then
    # значение записываем без sed, чтобы спецсимволы токена ничего не сломали
    grep -v "^${key}=" "$ENV" > "$ENV.tmp" && mv "$ENV.tmp" "$ENV"
  fi
  printf "%s='%s'\n" "$key" "$val" >> "$ENV"
}
set_var MAX_BOT_TOKEN "$MAX_BOT_TOKEN"
set_var MAX_BOT_USERNAME "$MAX_BOT_USERNAME"
chmod 600 "$ENV"

echo "Перезапускаю приложение..."
docker compose up -d --build app
sleep 8
echo
echo "Журнал (ищите строку «Бот Max ... запущен»):"
docker compose logs --tail=30 app | grep -i "max" || echo "Строк про Max пока нет: подождите минуту и выполните  docker compose logs --tail=40 app"
