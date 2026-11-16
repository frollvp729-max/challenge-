#!/usr/bin/env bash
# Сервер-посредник в России перед основным сервером.
# Провайдеры в РФ часто режут связь с зарубежными серверами, а связь между дата-центрами — редко.
# Этот сервер принимает подключения участников (80, 443) и SSH (порт 2222) и без расшифровки
# пересылает их на основной сервер. HTTPS-сертификат остаётся на основном сервере.
# Запуск на новом сервере: curl -fsSL https://raw.githubusercontent.com/frollvp729-max/challenge-/main/deploy/ru-proxy.sh | sudo bash
# Другой основной сервер: ... | sudo MAIN_IP=1.2.3.4 bash
set -euo pipefail
MAIN_IP="${MAIN_IP:-185.161.70.194}"

[ "$(id -u)" = 0 ] || { echo "Запустите через sudo"; exit 1; }
echo "==> Ставлю nginx"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx libnginx-mod-stream >/dev/null

# обычный сайт nginx не нужен: порты 80 и 443 займёт пересылка
rm -f /etc/nginx/sites-enabled/default
cat > /etc/nginx/stream-proxy.conf <<CONF
stream {
  server { listen 80;   proxy_pass ${MAIN_IP}:80;  proxy_connect_timeout 10s; }
  server { listen 443;  proxy_pass ${MAIN_IP}:443; proxy_connect_timeout 10s; }
  # SSH на основной сервер: ssh -p 2222 root@<адрес этого сервера>
  server { listen 2222; proxy_pass ${MAIN_IP}:22;  proxy_connect_timeout 10s; proxy_timeout 12h; }
}
CONF
grep -q "stream-proxy.conf" /etc/nginx/nginx.conf || echo "include /etc/nginx/stream-proxy.conf;" >> /etc/nginx/nginx.conf

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 2222/tcp >/dev/null
fi

nginx -t
systemctl enable --now nginx >/dev/null 2>&1 || true
systemctl restart nginx

echo "==> Проверяю связь с основным сервером ${MAIN_IP}"
if curl -fsS -m 15 --resolve "challengetyt.ru:443:127.0.0.1" https://challengetyt.ru/health; then
  echo
  echo "ГОТОВО. Теперь в reg.ru поменяйте A-записи @ и www на IP этого сервера:"
  curl -fsS -m 10 https://ipv4.icanhazip.com || hostname -I
else
  echo "ВНИМАНИЕ: этот сервер не достучался до ${MAIN_IP}. Пришлите скриншот."
fi
