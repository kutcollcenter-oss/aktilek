# Сайт Актилека Муктарбекова — квартиры в рассрочку

Личный сайт одного менеджера по недвижимости на своём домене (отдельно от kvartiry.asia):
каталог с подбором по взносу и платежу в месяц, калькулятор рассрочки, наличные / коммерция / участки, срок сдачи,
новости «Скоро», карты 2ГИС и Google, заявки в WhatsApp, русская и кыргызская версии, аналитика в кабинете.

Node.js + Express, обычный JavaScript на страницах. Данные — `data/db.json`, аналитика — `data/events/*.jsonl`, фото — `uploads/`.
**База и фото в GitHub не отправляются** (они в `.gitignore`) — живут только на сервере и в копиях.

## Адреса

| Адрес | Что это |
|---|---|
| `/` | Сайт для клиентов |
| `/kvartira/<id>` | Страница квартиры |
| `/privacy` | Политика конфиденциальности |
| `/admin` | Кабинет: квартиры, профиль, аналитика (один вход) |
| `/sitemap.xml`, `/robots.txt` | Для Google и Яндекса |

## Запуск на компьютере

```bash
npm install
npm start
```

Сайт: http://localhost:3010 , кабинет: http://localhost:3010/admin (порт можно сменить: `PORT=3011`).

Если базы ещё нет, при первом запуске создаётся пустой сайт; логин `admin`, пароль печатается в консоли.
Для проверки с демо-квартирами: `node lib/seed.js --demo` (существующую базу не трогает без `--force`).

## Перенос с kvartiry.asia

На kvartiry.asia ничего не меняется и не удаляется — данные только копируются оттуда на компьютер.

**1. Скачать свежую базу, фото и аналитику с сервера kvartiry.asia** (на компьютере, PowerShell; пароль root сервера kvartiry.asia):

```bash
scp root@158.220.88.217:/var/www/kvartiry/data/db.json C:\Users\arlen\kvartiry-backups\db-fresh.json
```

```bash
scp -r root@158.220.88.217:/var/www/kvartiry/uploads C:\Users\arlen\kvartiry-backups\uploads-fresh
```

```bash
scp -r root@158.220.88.217:/var/www/kvartiry/data/events C:\Users\arlen\kvartiry-backups\events-fresh
```

**2. Взять из них только сайт Актилека** (`/aktilek`): его профиль, квартиры, фото, аналитику и вход в кабинет (логин и пароль остаются прежними):

```bash
cd C:\Users\arlen\aktilek-site
node scripts/import-from-kvartiry.js --db C:\Users\arlen\kvartiry-backups\db-fresh.json --uploads C:\Users\arlen\kvartiry-backups\uploads-fresh --events C:\Users\arlen\kvartiry-backups\events-fresh --force
```

- Сначала можно посмотреть без записи: добавьте `--dry-run`.
- `--force` нужен, если база этого сайта уже есть; перед заменой делается копия в `data/backups/`.
- Список нужных файлов фото сохраняется в `data/import-files.txt`.

**3.** `npm start` и проверить сайт на http://localhost:3010. Затем перенести на сервер — [deploy/README.md](deploy/README.md), шаг 4.

## Переменные окружения

| Переменная | Назначение |
|---|---|
| `PORT` | Порт (по умолчанию 3010; на сервере 3000 за nginx) |
| `HOST` | На сервере `127.0.0.1` — сайт доступен только через nginx |
| `ADMIN_LOGIN`, `ADMIN_PASSWORD` | Логин и пароль для самой первой базы (если базы нет и перенос не делали) |

Забыт пароль — `node scripts/set-password.js` (при остановленном сайте), см. [deploy/README.md](deploy/README.md).

## Защита

Защитные заголовки (нельзя встроить сайт в чужую страницу и т. п.), пароль хранится только как хэш,
после 10 неверных паролей подряд вход закрыт на 15 минут, задержка при переборе с одного адреса,
nginx на том же сервере — единственный, кому сайт доверяет адрес посетителя (`trust proxy: loopback`).
Ежедневные копии базы — `data/backups/` (30 дней).

## Отправка кода на GitHub

Двойной клик по `publish.cmd` или:

```bash
C:\Users\arlen\aktilek-site\publish.cmd "что изменилось"
```

## На сервере

Пошаговая установка на свой VPS с доменом — [deploy/README.md](deploy/README.md) (systemd + nginx + бесплатный HTTPS).
