#!/usr/bin/env bash
# Первая установка сайта на чистый сервер Ubuntu 24.04. Запускать от root, указав домен:
#   bash /root/setup.sh yurta.kg
# (файл кладётся на сервер с компьютера командой scp — см. deploy/README.md, шаг 2).
# Без домена сайт будет открываться только по IP сервера.
# Если базы на сервере ещё нет, создаётся новый сайт с текстами YURTA INVEST; логин и пароль кабинета печатаются в конце.
set -euo pipefail

DOMAIN="${1:-}"
REPO_PATH=kutcollcenter-oss/aktilek
APP=/var/www/yurta
KEY=/root/.ssh/yurta_deploy

echo "== 1/7 Обновление системы и программы =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git nginx ufw certbot python3-certbot-nginx

echo "== 2/7 Node.js 22 LTS =="
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "== 3/7 Ключ сервера для чтения кода с GitHub (только чтение, только этот репозиторий) =="
mkdir -p /root/.ssh && chmod 700 /root/.ssh
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -C "yurta-server" -f "$KEY" >/dev/null
if ! grep -q "Host github-yurta" /root/.ssh/config 2>/dev/null; then
  printf 'Host github-yurta\n  HostName github.com\n  User git\n  IdentityFile %s\n  IdentitiesOnly yes\n' "$KEY" >> /root/.ssh/config
  chmod 600 /root/.ssh/config
fi
ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null
REPO="git@github-yurta:${REPO_PATH}.git"
until git ls-remote "$REPO" >/dev/null 2>&1; do
  echo
  echo "Добавьте этот ключ на GitHub: репозиторий ${REPO_PATH} → Settings → Deploy keys → Add deploy key"
  echo "(Title: server, галочку «Allow write access» НЕ ставить):"
  echo
  cat "$KEY.pub"
  echo
  read -r -p "Когда добавите — нажмите Enter… " _
done
echo "Доступ к коду есть."

echo "== 4/7 Пользователь и код сайта =="
id -u yurta >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin yurta
git config --global --add safe.directory "$APP"
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only; else git clone "$REPO" "$APP"; fi
mkdir -p "$APP/data" "$APP/uploads"
cd "$APP"
npm ci --omit=dev
chown -R yurta:yurta "$APP"

echo "== 5/7 Автозапуск сайта =="
cp "$APP/deploy/yurta.service" /etc/systemd/system/yurta.service
systemctl daemon-reload
systemctl enable yurta

echo "== 6/7 nginx =="
if [ -n "$DOMAIN" ]; then
  sed "s/DOMAIN/${DOMAIN}/g" "$APP/deploy/nginx.conf" > /etc/nginx/sites-available/yurta
else
  sed "s/server_name DOMAIN www.DOMAIN;/server_name _;/" "$APP/deploy/nginx.conf" > /etc/nginx/sites-available/yurta
fi
ln -sf /etc/nginx/sites-available/yurta /etc/nginx/sites-enabled/yurta
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "== 7/7 Защита: открыты только SSH и веб =="
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo
if [ ! -f "$APP/data/db.json" ]; then
  echo "== Новая база сайта. Запишите логин и пароль кабинета — они показываются один раз: =="
  sudo -u yurta node "$APP/lib/seed.js"
fi
systemctl restart yurta
sleep 2
systemctl is-active --quiet yurta && echo "Готово: сайт запущен." || { echo "Сайт не запустился:"; journalctl -u yurta -n 30 --no-pager; exit 1; }
