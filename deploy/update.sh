#!/usr/bin/env bash
# Обновить сайт на сервере после изменений в GitHub. Запускать от root:
#   bash /var/www/aktilek/deploy/update.sh
# База (data/) и фото (uploads/) на сервере не затрагиваются — их нет в GitHub.
set -euo pipefail
APP=/var/www/aktilek
cd "$APP"
git pull --ff-only
npm ci --omit=dev
chown -R aktilek:aktilek "$APP"
systemctl restart aktilek
sleep 2
systemctl is-active --quiet aktilek && echo "Сайт обновлён и работает." || { echo "Сайт не запустился, последние строки журнала:"; journalctl -u aktilek -n 30 --no-pager; exit 1; }
