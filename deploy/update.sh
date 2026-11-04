#!/usr/bin/env bash
# Обновить сайт на сервере после изменений в GitHub. Запускать от root:
#   bash /var/www/yurta/deploy/update.sh
# База (data/) и фото (uploads/) на сервере не затрагиваются — их нет в GitHub.
set -euo pipefail
APP=/var/www/yurta
cd "$APP"
git pull --ff-only
npm ci --omit=dev
chown -R yurta:yurta "$APP"
systemctl restart yurta
sleep 2
systemctl is-active --quiet yurta && echo "Сайт обновлён и работает." || { echo "Сайт не запустился, последние строки журнала:"; journalctl -u yurta -n 30 --no-pager; exit 1; }
