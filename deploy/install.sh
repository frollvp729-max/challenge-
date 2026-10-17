#!/usr/bin/env bash
# Установка платформы челленджей на чистый VPS (Ubuntu 22.04/24.04) одной командой:
#   curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/install.sh | sudo bash -s -- <git-url> [домен]
# Скрипт спросит токены сам: в чат и в историю команд они не попадают.
set -euo pipefail

REPO_URL="${1:?Укажи адрес репозитория: install.sh <git-url> [домен]}"
DOMAIN="${2:-vitalprobiznes.ru}"
DIR=/opt/challenge-platform

if [ "$(id -u)" -ne 0 ]; then
  echo "Запусти через sudo" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Ставлю Docker"
  curl -fsSL https://get.docker.com | sh
fi
command -v git >/dev/null 2>&1 || { apt-get update -y && apt-get install -y git; }

if [ -d "$DIR/.git" ]; then
  echo "==> Обновляю код в $DIR"
  git -C "$DIR" pull --ff-only
else
  echo "==> Клонирую $REPO_URL в $DIR"
  git clone "$REPO_URL" "$DIR"
fi
cd "$DIR"

ENV_FILE=apps/server/.env
if [ ! -f "$ENV_FILE" ]; then
  echo
  echo "==> Настройка. Значения не отображаются при вводе там, где это секрет."
  # read из /dev/tty, чтобы работало и при запуске через curl | bash
  read -r -p "Имя бота без @ (например vitalprobiznes_bot): " BOT_USERNAME </dev/tty
  read -r -s -p "Токен бота от @BotFather: " BOT_TOKEN </dev/tty; echo
  read -r -s -p "API-ключ Tribute (можно оставить пустым и добавить позже): " TRIBUTE_API_KEY </dev/tty; echo
  read -r -s -p "Пароль для админки: " ADMIN_PASSWORD </dev/tty; echo
  for v in "$BOT_TOKEN" "$TRIBUTE_API_KEY" "$ADMIN_PASSWORD"; do
    case "$v" in *"'"*) echo "Значения не должны содержать символ '" >&2; exit 1;; esac
  done
  umask 077
  cat > "$ENV_FILE" <<ENV
PUBLIC_URL=https://$DOMAIN
BOT_TOKEN='$BOT_TOKEN'
BOT_USERNAME=$BOT_USERNAME
BOT_MODE=polling
TRIBUTE_API_KEY='$TRIBUTE_API_KEY'
ADMIN_PASSWORD='$ADMIN_PASSWORD'
DEFAULT_TIMEZONE=Europe/Moscow
DEV_AUTH=0
LOG_LEVEL=info
ENV
  echo "DOMAIN=$DOMAIN" > .env
  echo "==> Настройки сохранены в $DIR/$ENV_FILE"
fi

echo "==> Собираю и запускаю"
docker compose up -d --build

echo
echo "Готово."
echo "  Mini App:   https://$DOMAIN/app/"
echo "  Админка:    https://$DOMAIN/admin/"
echo "  Вебхук Tribute: https://$DOMAIN/webhooks/tribute"
echo "Логи: cd $DIR && docker compose logs -f app"
