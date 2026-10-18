#!/usr/bin/env bash
# Установка платформы челленджей на чистый VPS (Ubuntu/Debian) одной командой:
#   curl -fsSL https://raw.githubusercontent.com/frollvp729-max/challenge-/main/deploy/install.sh | sudo bash
# Скрипт спросит токены сам: в чат и в историю команд они не попадают.
set -euo pipefail

REPO_URL="${1:-https://github.com/frollvp729-max/challenge-.git}"
DOMAIN="${2:-vitalprobiznes.ru}"
DIR=/opt/challenge-platform

if [ "$(id -u)" -ne 0 ]; then
  echo "Запусти через sudo" >&2
  exit 1
fi

# Сборка (npm + vite) не помещается в 1 ГБ памяти: на маленьком VPS добавляем подкачку
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 2000 ] && [ "$(swapon --noheadings 2>/dev/null | wc -l)" -eq 0 ]; then
  echo "==> Памяти ${MEM_MB} МБ, добавляю подкачку 2 ГБ"
  if { [ -f /swapfile ] || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none; } \
     && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile; then
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  else
    # на VPS-контейнерах (OpenVZ/LXC) подкачку включить нельзя, пробуем собрать без неё
    echo "    Подкачку включить не удалось, продолжаю без неё"
    rm -f /swapfile
  fi
fi

if ! command -v git >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then apt-get update -y && apt-get install -y git
  elif command -v dnf >/dev/null 2>&1; then dnf install -y git
  else yum install -y git; fi
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Ставлю Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
# Docker из пакетов Ubuntu (docker.io) идёт без compose: доставляем его
if ! docker compose version >/dev/null 2>&1; then
  echo "==> Ставлю docker compose"
  apt-get update -y >/dev/null
  apt-get install -y docker-compose-plugin 2>/dev/null || apt-get install -y docker-compose-v2
fi

# Caddy получает HTTPS-сертификат через порты 80 и 443
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

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
  read -r -p "Имя бота без @ [sugar_free_Bot]: " BOT_USERNAME </dev/tty
  BOT_USERNAME="${BOT_USERNAME:-sugar_free_Bot}"
  BOT_TOKEN=""
  until [[ "$BOT_TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]]; do
    [ -n "$BOT_TOKEN" ] && echo "Это не похоже на токен бота (вид: 123456789:AAE...). Попробуй ещё раз."
    read -r -s -p "Токен бота от @BotFather: " BOT_TOKEN </dev/tty; echo
  done
  read -r -s -p "API-ключ Tribute (можно оставить пустым и добавить позже): " TRIBUTE_API_KEY </dev/tty; echo
  ADMIN_PASSWORD=""
  while [ ${#ADMIN_PASSWORD} -lt 8 ]; do
    read -r -s -p "Пароль для админки (от 8 символов): " ADMIN_PASSWORD </dev/tty; echo
  done
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

SERVER_IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
DOMAIN_IP=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1; exit}')
if [ -n "$SERVER_IP" ] && [ "$DOMAIN_IP" != "$SERVER_IP" ]; then
  echo
  echo "!!! $DOMAIN сейчас указывает на '${DOMAIN_IP:-никуда}', а IP этого сервера $SERVER_IP."
  echo "!!! Создай A-записи $DOMAIN и www.$DOMAIN на $SERVER_IP. HTTPS включится сам, когда DNS обновится."
  echo
fi

echo "==> Собираю и запускаю (первая сборка идёт несколько минут)"
docker compose up -d --build

echo
echo "Готово."
echo "  Mini App:   https://$DOMAIN/app/"
echo "  Админка:    https://$DOMAIN/admin/"
echo "  Вебхук Tribute: https://$DOMAIN/webhooks/tribute"
echo "Логи: cd $DIR && docker compose logs -f app"
