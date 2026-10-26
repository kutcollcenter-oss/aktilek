# Установка на сервер Актилека (Ubuntu 24.04)

Нужно: IP сервера и пароль root (приходят от хостинга после покупки VPS), купленный домен (например `aktilek.kg`).
Команды «на компьютере» вводятся в PowerShell на компьютере, «на сервере» — в окне SSH.
Ниже вместо `IP_СЕРВЕРА` и `ДОМЕН` подставьте свои значения.

## 1. Домен → сервер

В панели, где куплен домен, раздел DNS: удалить старые записи `@` и `www`, если есть, и добавить:

| Тип | Имя (Host) | Значение |
|---|---|---|
| A | `@` | IP сервера |
| CNAME | `www` | `ДОМЕН` |

Начинает работать через 5–30 минут (иногда до пары часов).

## 2. Положить установщик на сервер и запустить

Репозиторий закрытый, поэтому установщик копируется с компьютера. На компьютере:

```bash
scp C:\Users\arlen\aktilek-site\deploy\setup.sh root@IP_СЕРВЕРА:/root/setup.sh
```

Первый раз спросит `Are you sure…` — напишите `yes`, затем пароль root (при вводе он не отображается — это нормально).

Подключиться к серверу:

```bash
ssh root@IP_СЕРВЕРА
```

На сервере:

```bash
bash /root/setup.sh ДОМЕН
```

## 3. Ключ доступа к коду (один раз)

На середине установки скрипт покажет строку `ssh-ed25519 AAAA… aktilek-server` и остановится.
Это ключ, по которому сервер **только читает** код из закрытого репозитория:

1. GitHub → репозиторий `kutcollcenter-oss/aktilek-site` → **Settings** → **Deploy keys** → **Add deploy key**.
2. Title: `server`, в Key — вставить строку целиком. Галочку **Allow write access не ставить**.
3. **Add key**, вернуться в окно SSH и нажать Enter.

Дальше скрипт ставит Node.js, nginx, защиту и код сайта (5–10 минут). Сайт пока не запускается.

## 4. Перенести базу и фото

Сначала на компьютере подготовить свежие данные с kvartiry.asia — см. «Перенос с kvartiry.asia» в [README.md](../README.md).
Затем на компьютере, в **новом** окне PowerShell (SSH не закрывать):

```bash
scp -r C:\Users\arlen\aktilek-site\data C:\Users\arlen\aktilek-site\uploads root@IP_СЕРВЕРА:/var/www/aktilek/
```

На сервере:

```bash
chown -R aktilek:aktilek /var/www/aktilek && systemctl start aktilek && systemctl status aktilek --no-pager
```

Должно быть `active (running)`. Сайт открывается по `http://IP_СЕРВЕРА`, а когда заработает домен — по `http://ДОМЕН`.

## 5. HTTPS (замок в браузере)

Когда `http://ДОМЕН` открывается, на сервере:

```bash
certbot --nginx -d ДОМЕН -d www.ДОМЕН --redirect --agree-tos -m ВАШ_EMAIL
```

Сертификат бесплатный и продлевается сам.

## 6. Вход в кабинет

`https://ДОМЕН/admin` — логин и пароль те же, что были у Актилека на kvartiry.asia.
Если он их не помнит — на сервере можно выдать новый пароль (он придумается сам и покажется один раз):

```bash
cd /var/www/aktilek && systemctl stop aktilek && sudo -u aktilek node scripts/set-password.js && systemctl start aktilek
```

## Обновить сайт после изменений

Код отправляется на GitHub с компьютера (`publish.cmd`), затем на сервере:

```bash
bash /var/www/aktilek/deploy/update.sh
```

База и фото на сервере при обновлении не затрагиваются.

## Полезное

```bash
systemctl status aktilek          # работает ли сайт
journalctl -u aktilek -n 50       # последние сообщения сайта
systemctl restart aktilek         # перезапустить
```

Резервные копии базы — `/var/www/aktilek/data/backups/` (каждый день, хранятся 30 дней).
