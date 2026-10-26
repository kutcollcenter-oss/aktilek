// Личный сайт одного менеджера по недвижимости: каталог квартир с подбором по взносу и платежу,
// калькулятор рассрочки, заявки в WhatsApp, русская и кыргызская версии. Кабинет — /admin (один вход).
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const db = require('./lib/db');
const seed = require('./lib/seed');
const { LANGS, KY_KEYS, langOk, localizeSettings } = require('./lib/i18n');
const { kyText, kyTag } = require('./lib/ky-fill');
const { migrateHandover, pendingHandover, dropHandoverTags } = require('./lib/handover');
const { publicApt, kindLabel, unitOf, isListed, typeOf, CITIES } = require('./lib/calc');
const { resolveMap } = require('./lib/maps');
const pages = require('./lib/pages');
const auth = require('./lib/auth');
const analytics = require('./lib/analytics');

const PORT = process.env.PORT || 3010;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 30;

const app = express();
// Доверяем только своему nginx на этом же сервере (127.0.0.1). Иначе адрес посетителя брался бы из заголовка
// X-Forwarded-For, который любой может подделать и так обойти задержку при подборе пароля.
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');

// Переключатель языка: ссылка «?lang=ky» или «?lang=ru» запоминает выбор на год и открывает ту же страницу без параметра
app.use((req, res, next) => {
  const l = req.method === 'GET' && req.query.lang;
  if (!LANGS.includes(l)) return next();
  res.setHeader('Set-Cookie', `lang=${l}; Path=/; Max-Age=31536000; SameSite=Lax${req.secure ? '; Secure' : ''}`);
  const q = new URLSearchParams(req.query); q.delete('lang');
  res.redirect(302, req.path + (q.toString() ? '?' + q : ''));
});

// Защитные заголовки для всех страниц
app.use((req, res, next) => {
  // Страница зависит от выбранного языка (cookie) — кэши должны это учитывать
  res.vary('Cookie');
  // Браузер не угадывает тип файла (картинку не исполнит как скрипт)
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Сайт и кабинет нельзя вставить в чужую страницу (защита от «невидимых кнопок»); свои карты /map/2gis — можно
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  // На другие сайты уходит только адрес домена, без пути и параметров
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Камера, микрофон и геолокация сайту не нужны
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // HTTPS всегда: браузер год не будет открывать сайт по http (только когда сайт уже открыт по HTTPS)
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '1mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 30 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// ---------- Данные ----------
// База: { secret, settings, user, apartments, done }
const D = () => db.data;
const S = () => D().settings;
const base = req => `${req.protocol}://${req.get('host')}`;
const findApt = id => D().apartments.find(a => a.id === id);
const isVisible = isListed; // статусов нет: на сайте все квартиры с ценой; проданную удаляют
// Язык сайта клиента: выбор хранится в cookie lang (ru — по умолчанию, ky — кыргызский). Роботы поиска видят русский.
const langOf = req => langOk(cookies(req).lang);
// Тексты профиля на языке страницы: на кыргызской версии — кыргызские варианты (если менеджер их заполнил)
const ctxOf = req => ({ s: localizeSettings(S(), langOf(req)), base: base(req), prefix: '', lang: langOf(req) });
const pub = (a, req, lang = langOf(req)) => publicApt(a, S(), base(req), '', lang);
const aptLabel = a => `${a.title ? a.title + ' · ' : ''}${kindLabel(a)}, ${a.area} ${unitOf(a)}`;

function similarTo(a, req, limit = 4) {
  const ref = a ? pub(a, req) : null;
  return D().apartments
    .filter(x => isVisible(x) && (!a || (x.id !== a.id && typeOf(x) === typeOf(a))))
    .map(x => pub(x, req))
    .sort((x, y) => {
      if (!ref) return 0;
      const sx = Math.abs(x.rooms - ref.rooms) * 2 + Math.abs(x.price - ref.price) / (ref.price || 1);
      const sy = Math.abs(y.rooms - ref.rooms) * 2 + Math.abs(y.price - ref.price) / (ref.price || 1);
      return sx - sy;
    })
    .slice(0, limit);
}

// ---------- Фото ----------
async function savePhoto(buffer) {
  const name = crypto.randomBytes(8).toString('hex');
  const img = sharp(buffer, { failOn: 'none' }).rotate();
  await img.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 }).toFile(path.join(UPLOAD_DIR, `${name}.webp`));
  await img.clone().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 }).toFile(path.join(UPLOAD_DIR, `${name}-t.webp`));
  await img.clone().resize({ width: 1200, height: 630, fit: 'cover' })
    .jpeg({ quality: 78, mozjpeg: true }).toFile(path.join(UPLOAD_DIR, `${name}-og.jpg`));
  return name;
}

// Логотип: сохраняем прозрачность, без обрезки
async function saveLogo(buffer) {
  const name = crypto.randomBytes(8).toString('hex');
  await sharp(buffer, { failOn: 'none' }).rotate().trim({ threshold: 10 })
    .resize({ height: 200, width: 600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90, alphaQuality: 100 }).toFile(path.join(UPLOAD_DIR, `${name}.webp`));
  return `/uploads/${name}.webp`;
}

function removePhotoFiles(name) {
  const used = D().apartments.some(a => (a.photos || []).includes(name))
    || (S().news || []).some(n => n.photo === name);
  if (used) return; // фото ещё используется в дубликате или в новости
  for (const f of [`${name}.webp`, `${name}-t.webp`, `${name}-og.jpg`]) {
    fs.unlink(path.join(UPLOAD_DIR, f), () => {});
  }
}

// ---------- Сессия кабинета ----------
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]));
}
function requireAuth(req, res, next) {
  const user = auth.readToken(D().secret, cookies(req).sess, id => (D().user.id === id ? D().user : null));
  if (!user) return res.status(401).json({ error: 'auth' });
  req.user = user;
  next();
}
function setSession(req, res, user) {
  const secure = req.secure ? '; Secure' : '';
  const token = user ? auth.makeToken(D().secret, user, SESSION_DAYS) : '';
  res.setHeader('Set-Cookie', `sess=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${user ? SESSION_DAYS * 86400 : 0}${secure}`);
}

// Защита от перебора паролей:
//  1) задержка после неудачных попыток с одного IP (до 5 секунд);
//  2) после 10 неверных паролей подряд вход в кабинет закрыт на 15 минут — с любого IP.
// Счётчики живут в памяти и забываются через час без попыток.
const fails = new Map();        // ip → { n, t }
const loginFails = new Map();   // login → { n, t, until }
const LOCK_AFTER = 10, LOCK_MS = 15 * 60 * 1000, FORGET_MS = 60 * 60 * 1000;
const failDelay = ip => Math.min(((fails.get(ip) || {}).n || 0) * 700, 5000);
setInterval(() => {
  const old = Date.now() - FORGET_MS;
  for (const m of [fails, loginFails]) for (const [k, v] of m) if (v.t < old && !(v.until > Date.now())) m.delete(k);
}, 10 * 60 * 1000).unref();

// ---------- Статика ----------
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
// Страница кабинета: к файлам скрипта и стилей добавляется версия, чтобы после обновления не открывалась старая копия из кэша
const ADMIN_DIR = path.join(__dirname, 'admin');
app.get(['/admin', '/admin/', '/admin/index.html'], (req, res) => {
  if (req.path === '/admin') return res.redirect(301, '/admin/');
  const v = f => Math.round(fs.statSync(path.join(ADMIN_DIR, f)).mtimeMs).toString(36);
  const html = fs.readFileSync(path.join(ADMIN_DIR, 'index.html'), 'utf8')
    .replace('/admin/admin.css', `/admin/admin.css?v=${v('admin.css')}`)
    .replace('/admin/admin.js', `/admin/admin.js?v=${v('admin.js')}`);
  res.set('Cache-Control', 'no-cache').type('html').send(html);
});
app.use('/admin', express.static(ADMIN_DIR));
app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));

// ---------- Иконка сайта ----------
// Иконка во вкладке, на экране телефона и для поиска — из логотипа менеджера (или его фото).
// Нет ни того, ни другого — первая буква имени. Готовые картинки хранятся в памяти до смены логотипа/фото.
const ICON_SIZES = new Set([32, 180, 192, 512]);
const iconCache = new Map();
const localFile = url => {
  const m = /^\/(uploads|img)\/([\w.-]+)$/.exec(String(url || ''));
  if (!m) return null;
  const f = m[1] === 'uploads' ? path.join(UPLOAD_DIR, m[2]) : path.join(PUBLIC_DIR, 'img', m[2]);
  return fs.existsSync(f) ? f : null;
};
async function makeIcon(size) {
  const s = S();
  const logo = localFile(s.logo), photo = !logo && localFile(s.photo);
  const key = `${logo || photo || s.name}|${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  let buf;
  try {
    if (logo) {
      // Логотип целиком, с полями, на белом фоне
      const inner = Math.round(size * 0.82);
      const pad = Math.floor((size - inner) / 2);
      buf = await sharp(logo).resize(inner, inner, { fit: 'contain', background: '#ffffff' })
        .extend({ top: pad, bottom: size - inner - pad, left: pad, right: size - inner - pad, background: '#ffffff' })
        .flatten({ background: '#ffffff' }).png().toBuffer();
    } else if (photo) {
      buf = await sharp(photo).resize(size, size, { fit: 'cover', position: 'top' }).png().toBuffer();
    }
  } catch (e) { buf = null; }
  if (!buf) {
    const letter = ((s.name || '').trim()[0] || '•').toUpperCase().replace(/[<&>"']/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="96" fill="#1f1f1f"/><text x="256" y="340" text-anchor="middle" font-family="Arial, sans-serif" font-size="280" font-weight="700" fill="#f2f1ee">${letter}</text></svg>`;
    buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  }
  if (iconCache.size > 20) iconCache.clear();
  iconCache.set(key, buf);
  return buf;
}
app.get('/icon-:size.png', async (req, res, next) => {
  const size = Number(req.params.size);
  if (!ICON_SIZES.has(size)) return next();
  res.set('Cache-Control', 'public, max-age=86400').type('image/png').send(await makeIcon(size));
});
// Браузеры и Яндекс сами запрашивают /favicon.ico (Яндекс советует от 120×120)
app.get('/favicon.ico', async (req, res) => res.set('Cache-Control', 'public, max-age=86400').type('image/png').send(await makeIcon(192)));

// ---------- Сайт для клиентов ----------
app.get('/', (req, res) => {
  const list = D().apartments.filter(isVisible).map(a => pub(a, req));
  res.send(pages.renderIndex(ctxOf(req), list));
});

app.get('/kvartira/:id', (req, res) => {
  const a = findApt(req.params.id);
  if (!a || !isVisible(a)) return res.status(404).send(pages.renderGone(ctxOf(req), similarTo(null, req)));
  res.send(pages.renderApartment(ctxOf(req), pub(a, req), similarTo(a, req)));
});

app.get('/privacy', (req, res) => res.send(pages.renderPrivacy(ctxOf(req))));

// Поисковикам: кабинет и служебные адреса не индексировать, карта сайта — /sitemap.xml
app.get('/robots.txt', (req, res) => res.type('text/plain').send(
  `User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /map/\n\nSitemap: ${base(req)}/sitemap.xml\n`));

// Карта сайта для Google и Яндекса: главная и все квартиры.
// Каталог на сайте рисуется скриптом, поэтому здесь поисковик сразу получает все адреса квартир.
app.get('/sitemap.xml', (req, res) => {
  const b = base(req);
  const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const day = v => (v ? String(v).slice(0, 10) : '');
  const list = D().apartments.filter(isVisible);
  const urls = [{ loc: `${b}/`, last: list.map(a => day(a.createdAt)).sort().pop(), pri: '1.0' }];
  for (const a of list) urls.push({ loc: `${b}/kvartira/${a.id}`, last: day(a.createdAt), pri: '0.8' });
  const body = urls.map(u => `<url><loc>${xmlEsc(u.loc)}</loc>${u.last ? `<lastmod>${u.last}</lastmod>` : ''}<priority>${u.pri}</priority></url>`).join('\n');
  res.set('Cache-Control', 'public, max-age=3600').type('application/xml')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
});

// Карта 2ГИС с меткой — встраивается в страницу квартиры (2gis.kg запрещает показывать себя внутри других сайтов)
// Плитки карты 2ГИС (те же, что в приложении) рисует библиотека Leaflet; ключ 2ГИС не нужен. Метка — на доме.
app.get('/map/2gis', (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return res.status(400).type('text/plain').send('bad point');
  res.set('Cache-Control', 'public, max-age=86400').type('html').send(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Карта 2ГИС</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
<style>html,body,#map{margin:0;height:100%;background:#f2efe6}
.pin svg{display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}</style></head><body><div id="map"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
  var p = [${lat}, ${lng}];
  var map = L.map('map', { center: p, zoom: 17, scrollWheelZoom: false, attributionControl: true });
  L.tileLayer('https://tile{s}.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1', {
    subdomains: '0123', maxZoom: 18, attribution: '&copy; <a href="https://2gis.kg" target="_blank" rel="noopener">2ГИС</a>'
  }).addTo(map);
  // Метка в стиле 2ГИС: синяя капля
  var pin = L.divIcon({ className: 'pin', iconSize: [30, 42], iconAnchor: [15, 41],
    html: '<svg width="30" height="42" viewBox="0 0 30 42"><path d="M15 0C6.7 0 0 6.6 0 14.8 0 26 15 42 15 42s15-16 15-27.2C30 6.6 23.3 0 15 0z" fill="#1a8cff"/><circle cx="15" cy="15" r="6" fill="#fff"/></svg>' });
  L.marker(p, { icon: pin, keyboard: false }).addTo(map);
</script></body></html>`);
});

// ---------- Аналитика: приём событий с сайта ----------
const EVENTS = new Set(['view', 'filter', 'calc', 'cash', 'wa']);
const PAGES = new Set(['home', 'apt', 'gone', 'privacy']);
const rate = new Map(); // ip → { n, reset }
const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
setInterval(() => { const now = Date.now(); for (const [k, v] of rate) if (now > v.reset) rate.delete(k); }, 10 * 60 * 1000).unref();

app.post('/api/track', express.text({ type: '*/*' }), (req, res) => {
  res.status(204).end();
  const now = Date.now();
  const q = rate.get(req.ip) || { n: 0, reset: now + 60e3 };
  if (now > q.reset) { q.n = 0; q.reset = now + 60e3; }
  if (++q.n > 120) return; // больше 120 событий в минуту с одного IP — не записываем
  rate.set(req.ip, q);

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { return; } }
  if (!b || !EVENTS.has(b.e)) return;
  const apt = b.a ? findApt(String(b.a)) : null;
  analytics.append({
    t: new Date().toISOString(), e: b.e,
    p: PAGES.has(b.p) ? b.p : null,
    a: apt ? apt.id : null,
    pl: clip(b.pl, 30),
    v: /^[a-z0-9]{6,16}$/.test(b.v || '') ? b.v : null,
    s: /^[a-z0-9_-]{1,30}$/.test(b.s || '') ? b.s : 'direct',
    d: b.d === 'd' ? 'd' : 'm',
  });
});

// ---------- Кабинет: вход ----------
app.post('/api/admin/login', async (req, res) => {
  await new Promise(r => setTimeout(r, failDelay(req.ip)));
  const login = String(req.body.login || '').trim().toLowerCase();
  const user = D().user.login === login ? D().user : null;
  const lock = user && loginFails.get(login);
  if (lock && lock.until > Date.now()) {
    const min = Math.ceil((lock.until - Date.now()) / 60000);
    return res.status(429).json({ error: `Слишком много неверных паролей. Вход в кабинет закрыт на ${min} мин. Попробуйте позже.` });
  }
  if (!auth.checkPassword(user, req.body.password)) {
    const f = fails.get(req.ip) || { n: 0 };
    f.n++; f.t = Date.now(); fails.set(req.ip, f);
    if (user) {
      const l = loginFails.get(login) || { n: 0 };
      l.n++; l.t = Date.now();
      if (l.n >= LOCK_AFTER) { l.until = Date.now() + LOCK_MS; l.n = 0; console.warn(`Вход в кабинет закрыт на 15 минут: ${LOCK_AFTER} неверных паролей подряд (последний IP ${req.ip})`); }
      loginFails.set(login, l);
    }
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  fails.delete(req.ip);
  loginFails.delete(login);
  setSession(req, res, user);
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => { setSession(req, res, null); res.json({ ok: true }); });

app.get('/api/admin/me', requireAuth, (req, res) => {
  res.json({
    login: req.user.login,
    defaultPassword: !!req.user.defaultPassword,
    site: { url: base(req), name: S().name, count: D().apartments.length },
  });
});

app.post('/api/admin/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!auth.checkPassword(req.user, current)) return res.status(400).json({ error: 'Текущий пароль неверный' });
  if (typeof next !== 'string' || next.length < 8) return res.status(400).json({ error: 'Новый пароль — минимум 8 символов' });
  Object.assign(req.user, auth.hashPassword(next), { defaultPassword: false });
  db.save();
  setSession(req, res, req.user); // старые сессии на других устройствах закрываются
  res.json({ ok: true });
});

// ---------- Кабинет: квартиры ----------
const adminApt = (a, req) => ({ ...a, computed: pub(a, req, 'ru') }); // кабинет всегда по-русски

app.get('/api/admin/apartments', requireAuth, (req, res) => {
  const list = [...D().apartments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(list.map(a => adminApt(a, req)));
});

const FIELDS = {
  type: v => typeOf({ type: v }),
  title: v => String(v || '').trim().slice(0, 120),
  rooms: v => Math.max(0, Math.min(10, parseInt(v) || 0)),
  area: v => Math.max(0, Number(v) || 0),
  pricePerM2: v => Math.max(0, Number(v) || 0),              // рассрочка, сом за м²
  down: v => Math.max(0, Number(v) || 0),                    // рассрочка, минимальный взнос
  months: v => Math.max(0, Math.min(240, parseInt(v) || 0)), // рассрочка, срок
  cashDiscount: v => Math.max(0, Number(v) || 0),            // рассрочка: скидка за наличные, сом за м²
  price: v => Math.max(0, Number(v) || 0),                   // наличные и участки, цена в $ (у участка площадь в сотках)
  floorFrom: v => Math.max(0, parseInt(v) || 0),
  floors: v => Math.max(0, parseInt(v) || 0),
  handover: v => String(v || '').trim().slice(0, 60),             // срок сдачи дома: рассрочка и коммерция
  city: v => (CITIES.includes(v) ? v : CITIES[0]),          // город: Бишкек или Ош
  address: v => String(v || '').trim().slice(0, 200),
  details: v => String(v || '').trim().slice(0, 5000),
  tags: v => (Array.isArray(v) ? v : String(v || '').split(',')).map(t => String(t).trim()).filter(Boolean).slice(0, 8),
  // Кыргызская версия сайта: детали и метки по-кыргызски (пусто — показываются русские)
  detailsKy: v => String(v || '').trim().slice(0, 5000),
  tagsKy: v => (Array.isArray(v) ? v : String(v || '').split(',')).map(t => String(t).trim()).filter(Boolean).slice(0, 8),
};
function pick(body) {
  const out = {};
  for (const k of Object.keys(FIELDS)) if (k in body) out[k] = FIELDS[k](body[k]);
  return out;
}

// Фото загружаются до сохранения квартиры; принимаем только реально существующие файлы
const PHOTO_RE = /^[0-9a-f]{16}$/;
function cleanPhotos(list) {
  if (!Array.isArray(list)) return null;
  return [...new Set(list)].filter(p => PHOTO_RE.test(p) && fs.existsSync(path.join(UPLOAD_DIR, `${p}.webp`))).slice(0, 40);
}

app.post('/api/admin/photos', requireAuth, upload.array('photos', 30), async (req, res) => {
  try {
    const names = [];
    for (const f of req.files || []) names.push(await savePhoto(f.buffer));
    res.json({ photos: names });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: 'Не удалось обработать фото' });
  }
});

// Ссылка на карту (одно поле mapLink → a.map): 2ГИС или Google Карты. Точку распознаём при сохранении
// (короткие ссылки раскрываются здесь, на сервере). На сайте: ссылка 2ГИС → карта 2ГИС, Google → карта Google.
async function applyMap(a, body) {
  if (!('mapLink' in body)) return;
  const link = String(body.mapLink || '').trim().slice(0, 2000);
  const old = a.map || a.map2gis;
  delete a.map2gis; // старое второе поле: теперь всё в одном
  if (!link) { delete a.map; return; }
  if (old && old.link === link && !old.error) { a.map = old; return; } // не изменилась
  a.map = await resolveMap(link);
}

app.post('/api/admin/apartments', requireAuth, async (req, res) => {
  const a = {
    id: db.newId(),
    type: 'installment', title: '', rooms: 1, area: 0, pricePerM2: 0, down: 0, months: 0, price: 0,
    floorFrom: 1, floors: 0, address: '', details: '', tags: [], photos: cleanPhotos(req.body.photos) || [],
    createdAt: new Date().toISOString(), ...pick(req.body || {}),
  };
  await applyMap(a, req.body || {});
  D().apartments.push(a);
  db.save();
  res.json(adminApt(a, req));
});

app.put('/api/admin/apartments/:id', requireAuth, async (req, res) => {
  const a = findApt(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  Object.assign(a, pick(req.body || {}));
  await applyMap(a, req.body || {});
  const photos = cleanPhotos(req.body.photos);
  if (photos) {
    const removed = a.photos.filter(p => !photos.includes(p));
    a.photos = photos;
    removed.forEach(removePhotoFiles);
  }
  db.save();
  res.json(adminApt(a, req));
});

app.post('/api/admin/apartments/:id/duplicate', requireAuth, (req, res) => {
  const a = findApt(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  const copy = { ...a, id: db.newId(), photos: [...a.photos], tags: [...a.tags], createdAt: new Date().toISOString() };
  D().apartments.push(copy);
  db.save();
  res.json(adminApt(copy, req));
});

app.delete('/api/admin/apartments/:id', requireAuth, (req, res) => {
  const i = D().apartments.findIndex(a => a.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'not found' });
  const [a] = D().apartments.splice(i, 1);
  db.save();
  (a.photos || []).forEach(removePhotoFiles);
  res.json({ ok: true });
});

// ---------- Кабинет: профиль (тексты сайта) ----------
const SETTINGS_KEYS = ['name', 'role', 'company', 'tagline', 'about', 'stats', 'whatsapp', 'instagram', 'officeAddress', 'officeLink',
  'currencyInstallment', 'currencyCash', 'heroKicker', 'heroPoints', 'ctaTitle', 'ctaText', 'steps', 'documents', 'reviews', 'faq', 'privacy',
  ...KY_KEYS.map(k => k + 'Ky')]; // кыргызские варианты текстов профиля
// Поля старого раздела «Уведомления и внешние счётчики» (там мог оказаться пароль, подставленный браузером) — стираются при запуске
const DROPPED_KEYS = ['gaId', 'ymId', 'pixelId', 'tgToken', 'tgChat'];

app.get('/api/admin/settings', requireAuth, (req, res) => res.json(S()));

// Новости «Скоро» на главной: до 6 штук — заголовок, текст и одно фото (из /api/admin/photos)
const NEWS_MAX = 6;
function cleanNews(list) {
  return list.slice(0, NEWS_MAX).map(n => {
    const photo = cleanPhotos([n && n.photo]) || [];
    return {
      id: n && /^[a-z0-9]{4,24}$/i.test(String(n.id || '')) ? String(n.id) : db.newId(),
      title: String((n && n.title) || '').trim().slice(0, 120),
      text: String((n && n.text) || '').trim().slice(0, 1000),
      titleKy: String((n && n.titleKy) || '').trim().slice(0, 120),
      textKy: String((n && n.textKy) || '').trim().slice(0, 1000),
      photo: photo[0] || '',
    };
  }).filter(n => n.title || n.text);
}

app.put('/api/admin/settings', requireAuth, (req, res) => {
  const s = S();
  for (const k of SETTINGS_KEYS) {
    if (!(k in req.body)) continue;
    s[k] = String(req.body[k] ?? '').slice(0, 10000);
  }
  if (Array.isArray(req.body.news)) {
    const before = (s.news || []).map(n => n.photo).filter(Boolean);
    s.news = cleanNews(req.body.news);
    db.save();
    before.filter(p => !s.news.some(n => n.photo === p)).forEach(removePhotoFiles);
  }
  db.save();
  res.json(s);
});

app.post('/api/admin/settings/photo', requireAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Нет файла' });
  try {
    const name = await savePhoto(req.file.buffer);
    S().photo = `/uploads/${name}.webp`;
    db.save();
    res.json(S());
  } catch (e) {
    res.status(400).json({ error: 'Не удалось обработать фото' });
  }
});

app.post('/api/admin/settings/logo', requireAuth, upload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Нет файла' });
  try {
    S().logo = await saveLogo(req.file.buffer);
    db.save();
    res.json(S());
  } catch (e) {
    res.status(400).json({ error: 'Не удалось обработать логотип' });
  }
});

app.delete('/api/admin/settings/logo', requireAuth, (req, res) => {
  S().logo = '';
  db.save();
  res.json(S());
});

// ---------- Кабинет: подробная аналитика ----------
app.get('/api/admin/analytics', requireAuth, (req, res) => {
  const days = [7, 30, 90].includes(+req.query.days) ? +req.query.days : 30;
  const label = id => { const a = findApt(id); return a && aptLabel(a); };
  res.json(analytics.report(days, label));
});

app.use((req, res) => res.status(404).send(pages.renderNotFound(ctxOf(req))));

// Копия базы перед разовым изменением данных: data/backups/<имя>-ДАТА.json
function backupBefore(name) {
  const dir = path.join(db.DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const copy = path.join(dir, `${name}-${new Date().toISOString().slice(0, 10)}.json`);
  if (!fs.existsSync(copy)) fs.copyFileSync(path.join(db.DATA_DIR, 'db.json'), copy);
  return copy;
}

(async () => {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!db.exists()) await seed();
  db.load();
  if (!D().settings || !D().user || !Array.isArray(D().apartments)) {
    console.error('data/db.json — не база этого сайта (нет settings, user или apartments).');
    console.error('Базу kvartiry.asia нужно сначала перенести: node scripts/import-from-kvartiry.js (см. README.md).');
    process.exit(1);
  }
  D().done = D().done || {};
  // Срок сдачи: один раз переносим фразу о сроке из «Деталей» в отдельное поле (остальной текст «Деталей» остаётся)
  if (pendingHandover(D().apartments, typeOf)) console.log('Копия базы перед переносом срока сдачи: ' + backupBefore('before-handover'));
  const ho = migrateHandover(D().apartments, typeOf, line => console.log('Срок сдачи — ' + line));
  if (ho.touched) { db.save(); console.log(`Срок сдачи: проверено ${ho.touched} квартир, найдено ${ho.found}`); }
  // Один раз: убрать старые метки со сроком («Сдача в 2030 2 квартал») там, где срок уже в поле.
  // Отметка done.handoverTags — чтобы метки, которые менеджер добавит потом сам, не трогать.
  if (!D().done.handoverTags) {
    console.log('Копия базы перед чисткой меток со сроком: ' + backupBefore('before-handover-tags'));
    const t = dropHandoverTags(D().apartments, typeOf, line => console.log('Метки — ' + line));
    D().done.handoverTags = new Date().toISOString();
    db.save();
    console.log(`Метки со сроком: перенесено в поле ${t.moved}, убрано повторов ${t.removed}`);
  }
  // Один раз: кыргызские переводы уже написанных текстов (lib/ky-fill.js) — только в пустые кыргызские поля.
  // Отметка done.kyFill — чтобы потом не трогать то, что менеджер поменял или очистил сам.
  if (!D().done.kyFill) {
    const copy = backupBefore('before-ky');
    let texts = 0, apts = 0;
    const s = S();
    for (const k of KY_KEYS) if (!String(s[k + 'Ky'] || '').trim() && kyText(s[k])) { s[k + 'Ky'] = kyText(s[k]); texts++; }
    for (const n of s.news || []) {
      if (!n.titleKy && kyText(n.title)) { n.titleKy = kyText(n.title); texts++; }
      if (!n.textKy && kyText(n.text)) { n.textKy = kyText(n.text); texts++; }
    }
    for (const a of D().apartments) {
      let changed = false;
      if (!a.detailsKy && kyText(a.details)) { a.detailsKy = kyText(a.details); changed = true; }
      if (!a.tagsKy && Array.isArray(a.tags) && a.tags.length) { a.tagsKy = a.tags.map(kyTag); changed = true; }
      if (changed) apts++;
    }
    D().done.kyFill = new Date().toISOString();
    db.save();
    console.log(`Кыргызские тексты: копия базы ${copy}; заполнено текстов профиля и новостей ${texts}, квартир ${apts}`);
  }
  let dropped = false;
  for (const k of DROPPED_KEYS) if (k in S()) { delete S()[k]; dropped = true; }
  if (dropped) db.save();
  analytics.prune();
  db.scheduleBackups();
  // На сервере HOST=127.0.0.1: сайт доступен только через nginx (HTTPS), напрямую порт закрыт
  app.listen(PORT, process.env.HOST || '0.0.0.0', () => {
    console.log(`Сайт:    http://localhost:${PORT}`);
    console.log(`Кабинет: http://localhost:${PORT}/admin  (логин ${D().user.login})`);
    if (D().user.defaultPassword) console.log('ВНИМАНИЕ: смените пароль в кабинете (Профиль → Пароль от кабинета)');
  });
})();
