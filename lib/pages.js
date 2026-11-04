// Серверный рендер страниц (нужен для SEO и превью ссылок в WhatsApp)
const fs = require('fs');
const path = require('path');
const logoBg = require('./logo-bg');
const { money, waLink, roomsLabel, handoverLabel } = require('./calc');
const { t, plural, dict } = require('./i18n');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = v => JSON.stringify(v).replace(/</g, '\\u003c');

const INDEX_TPL = path.join(__dirname, '..', 'views', 'index.html');
// Версия для сброса кэша CSS/JS: меняется при изменении файлов
const ASSETS = ['css/style.css', 'css/apple.css', 'js/common.js', 'js/app.js', 'js/apartment.js'].map(p => path.join(__dirname, '..', 'public', p));
const version = () => Math.max(...ASSETS.map(p => fs.statSync(p).mtimeMs)).toString(36).replace('.', '');

const WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1.1 2.7.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>';

const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  bed: svg('<path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 14h18M3 18v2M21 18v2M7 9V6h10v3"/>'),
  area: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h3M4 14h3M9 4v3M14 4v3"/>'),
  calendar: svg('<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
  floor: svg('<path d="M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 8h1M8 12h1M15 8h1M15 12h1"/>'),
  pin: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  home: svg('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>'),
  grid: svg('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
  star: svg('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3Z"/>'),
  insta: svg('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/>'),
};

// Иконка сайта (во вкладке, в поиске, на экране телефона) делается из логотипа или фото менеджера — см. /icon-*.png в server.js
const ICON = { icon: '/icon-32.png', icon192: '/icon-192.png', touch: '/icon-180.png' };

// Структурированные данные для Google и Яндекса (schema.org в формате JSON-LD).
// «<» экранируется, чтобы текст из базы не мог закрыть тег <script>.
const jsonLd = data => (data ? `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>` : '');

// Стиль «как у iPhone» (apple.css поверх style.css) — тот же, что у сайтов kvartiry.asia.
// Открыли из Instagram (или Facebook) — их встроенный браузер медленный и часто не открывает сайт.
// Один раз за визит перекидываем в настоящий браузер: Android → Chrome (если его нет — остаёмся),
// iPhone → Safari (схема x-safari-https, iOS 17+). Если не перекинуло — сверху подсказка, как открыть вручную.
const OPEN_IN_BROWSER = `<script>(function(){var ua=navigator.userAgent||'';if(!/Instagram|FBAN|FBAV|FB_IAB/.test(ua))return;
var tried=true;try{tried=!!sessionStorage.getItem('extOpen');sessionStorage.setItem('extOpen','1')}catch(e){}
var u=location.href,and=/Android/i.test(ua),ios=/iPhone|iPad|iPod/i.test(ua);
if(!tried){if(and){location.href='intent://'+u.replace(/^https?:\\/\\//,'')+'#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url='+encodeURIComponent(u)+';end';return}
if(ios){location.href='x-safari-'+u;}}
document.addEventListener('DOMContentLoaded',function(){var b=document.createElement('div');b.className='iab-tip';
b.innerHTML='<span>Сайт быстрее работает в '+(ios?'Safari':'Chrome')+': нажмите <b>⋯</b> вверху справа → «'+(ios?'Открыть в браузере':'Открыть в Chrome')+'»</span><button type="button" aria-label="Закрыть">×</button>';
b.querySelector('button').onclick=function(){b.remove()};document.body.insertBefore(b,document.body.firstChild)});})();</script>
<style>.iab-tip{position:relative;z-index:9999;display:flex;align-items:center;gap:10px;padding:10px 14px;background:#1d1d1f;color:#fff;font:14px/1.35 -apple-system,system-ui,sans-serif}.iab-tip span{flex:1}.iab-tip button{border:0;background:none;color:#fff;font-size:22px;line-height:1;padding:0 4px;cursor:pointer}</style>`;

function head({ title, description, image, url, settings, ld, lang = 'ru' }) {
  const origin = String(url || '').replace(/^(https?:\/\/[^/]+).*$/, '$1');
  // Картинка превью ссылки: своя у страницы или фото менеджера
  const ogImage = image || (origin && settings.photo ? origin + settings.photo.replace(/\.webp$/, '-og.jpg') : '');
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(settings.name || '')}">
<meta property="og:locale" content="${t(lang, 'ogLocale')}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}"><meta name="twitter:card" content="summary_large_image">` : ''}
<meta name="theme-color" content="#ffffff">
<script>document.documentElement.classList.add('js');setTimeout(function(){document.documentElement.classList.add('ready','pl-done')},4000)</script>
${OPEN_IN_BROWSER}
<link rel="icon" type="image/png" sizes="32x32" href="${ICON.icon}">
<link rel="icon" type="image/png" sizes="192x192" href="${ICON.icon192}">
<link rel="apple-touch-icon" href="${ICON.touch}">
${jsonLd(ld)}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css?v=${version()}">
<link rel="stylesheet" href="/css/apple.css?v=${version()}">`;
}

function publicSettings(s) {
  const { tgToken, tgChat, ...rest } = s;
  return rest;
}

// Ник Instagram для показа: «@yurta_invest» — из ника или ссылки, которую ввели в кабинете
const igNick = s => '@' + String(s.instagram || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
// Словарик под «Деталями»: если в тексте есть «ПСО», «черновая отделка», «Красная книга» — объясняем одной фразой
const GLOSSARY = [
  [/(^|[^а-яё])псо(?![а-яё])/i, 'glossPso'],
  [/черн[оа]в|кара иштетүү/i, 'glossRough'],
  [/красн(ая|ой|ую) книг|кызыл китеп/i, 'glossRedBook'],
];
function glossary(text, lang) {
  const items = GLOSSARY.filter(([re]) => re.test(text)).map(([, k]) => `<li>${esc(t(lang, k))}</li>`);
  return items.length ? `<div class="gloss"><b>${esc(t(lang, 'glossTitle'))}</b><ul>${items.join('')}</ul></div>` : '';
}
const igLink = s => `https://instagram.com/${String(s.instagram).replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '')}`;

// Логотип (загружается в кабинете). Нет логотипа — не показываем ничего.
// Сплошной фон у логотипа (например, белый) — вокруг него плашка того же цвета (см. lib/logo-bg.js)
function logo(s, cls = '', w = 50, h = 30) {
  if (!s.logo) return '';
  const bg = logoBg.get(s.logo);
  const plate = bg ? ` style="--logo-bg:${bg}"` : '';
  return `<img src="${esc(s.logo)}" alt="${esc(s.company || s.name)}" class="${cls}${bg ? ' logo-plate' : ''}" width="${w}" height="${h}"${plate}>`;
}

// ctx — { s: настройки на языке страницы, base: «https://домен», prefix: '' (сайт живёт в корне домена), lang }

// Есть ли у менеджера отзывы. Нет — раздела «Отзывы» на странице нет, и пункт меню тоже не показываем.
const hasReviews = s => /\S/.test(String(s.reviews || ''));

// Шапка. Верхнее меню и кнопка WhatsApp видны только на ноутбуке (≥1024 px), на телефоне и планшете — нижнее меню.
// Переключатель языка «Рус / Кыр»: ссылка ?lang=… запоминает выбор (см. server.js) и открывает ту же страницу
function langSwitch(lang) {
  return `<div class="lang-sw" role="group" aria-label="Тил / Язык">${['ky', 'ru'].map(l =>
    `<a href="?lang=${l}" hreflang="${l}" lang="${l}" title="${t(l, 'langName')}"${l === lang ? ' class="on" aria-current="true"' : ''}>${t(l, 'langShort')}</a>`).join('')}</div>`;
}

function header(ctx, home = false) {
  const { s, prefix, lang } = ctx;
  const p = home ? '' : `${prefix}/`;
  return `<header class="topbar"><div class="wrap">
  <a href="${prefix}/" class="brand">${logo(s)}<span><b>${esc(s.name)}</b><small>${esc(s.role || '')}</small></span></a>
  <nav class="nav"><a href="${p}#catalog">${t(lang, 'navApartments')}</a>${hasReviews(s) ? `<a href="${p}#reviews-sec">${t(lang, 'navReviews')}</a>` : ''}<a href="${p}#faq-sec">${t(lang, 'navQuestions')}</a></nav>
  ${langSwitch(lang)}
  ${s.whatsapp ? `<a href="${esc(waLink(s.whatsapp, t(lang, 'waGeneral')))}" class="btn btn-wa head-cta" data-wa="header" target="_blank" rel="noopener">${WA_ICON}WhatsApp</a>` : ''}
</div></header>`;
}

// Нижнее меню — на телефоне и планшете. home=true: якоря на главной, иначе ссылки на главную.
function tabbar(ctx, { home = false, active = '', waText = '', waPlace = 'tabbar', aptId = '' } = {}) {
  const { s, prefix, lang } = ctx;
  if (!waText) waText = t(lang, 'waGeneral');
  const p = home ? '' : `${prefix}/`;
  const item = (key, href, icon, label) =>
    `<a href="${href}" class="tab${active === key ? ' on' : ''}" data-tab="${key}">${icon}<span>${label}</span></a>`;
  return `<nav class="tabbar" aria-label="${t(lang, 'menu')}">
  ${item('home', home ? '#top' : `${prefix}/`, ICONS.home, t(lang, 'navHome'))}
  ${item('catalog', `${p}#catalog`, ICONS.grid, t(lang, 'navApartments'))}
  ${hasReviews(s) ? item('reviews', `${p}#reviews-sec`, ICONS.star, t(lang, 'navReviews')) : ''}
  <a href="${esc(waLink(s.whatsapp, waText))}" class="tab tab-wa" id="tabWa" data-wa="${waPlace}"${aptId ? ` data-id="${aptId}"` : ''} target="_blank" rel="noopener">${WA_ICON}<span>WhatsApp</span></a>
</nav>`;
}

// Подвал: тёмный фон с ночным силуэтом стройки и строка с документами и ©.
// Имя, контакты и разделы в подвал не выводим — они уже есть на странице и в меню.
function footer(ctx) {
  const { s, prefix, lang } = ctx;
  return `<footer class="footer fx fx-short"><div class="wrap">
  <div class="fx-bottom">
    <nav class="fx-legal" aria-label="${t(lang, 'docsNav')}">${s.instagram ? `<a href="${esc(igLink(s))}" target="_blank" rel="noopener">Instagram ${esc(igNick(s))}</a>` : ''}<a href="${prefix}/privacy">${t(lang, 'privacy')}</a></nav>
    <span class="fx-copy">${esc(s.name)} / © ${new Date().getFullYear()}</span>
  </div>
</div></footer>`;
}

// page — для аналитики: home | apt | gone | privacy
function scripts(ctx, page, extra = {}, files = ['common']) {
  // lang и t — язык страницы и словарь для скриптов (common.js, app.js, apartment.js)
  return `<script>window.__DATA__=${json({ settings: publicSettings(ctx.s), page, lang: ctx.lang || 'ru', t: dict(ctx.lang), waIcon: WA_ICON, icons: ICONS, ...extra })}</script>
${files.map(f => `<script src="/js/${f}.js?v=${version()}"></script>`).join('\n')}`;
}

// Код валюты для schema.org: «сом» → KGS, «$» → USD; иначе цену без валюты не указываем
const currencyCode = c => ({ 'сом': 'KGS', 'сом.': 'KGS', '$': 'USD', 'usd': 'USD' }[String(c || '').trim().toLowerCase()] || '');
const phoneOf = s => { const d = String(s.whatsapp || '').replace(/\D/g, ''); return d ? '+' + d : undefined; };
const abs = (base, u) => (u ? (/^https?:/.test(u) ? u : base + u) : undefined);

// Агентство недвижимости + список квартир (каталог рисуется скриптом, а так поисковик видит ссылки сразу)
function agentLd(ctx, apartments) {
  const { s, base, prefix } = ctx;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'RealEstateAgent',
        '@id': base + prefix + '/#agent',
        name: s.name,
        description: s.tagline || undefined,
        url: base + prefix + '/',
        image: abs(base, s.photo),
        logo: abs(base, s.logo),
        telephone: phoneOf(s),
        address: s.officeAddress ? { '@type': 'PostalAddress', streetAddress: s.officeAddress } : undefined,
        sameAs: s.instagram ? [igLink(s)] : undefined,
      },
      apartments.length ? {
        '@type': 'ItemList',
        name: `${t(ctx.lang, 'navApartments')} — ${s.name}`,
        itemListElement: apartments.map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: base + a.url, name: `${a.roomsLabel}, ${a.area} ${a.unit}${a.title ? ' — ' + a.title : ''}` })),
      } : undefined,
    ].filter(Boolean),
  };
}

// Квартира: предложение с ценой, адресом и фото + «хлебные крошки» (сайт менеджера → квартира)
function apartmentLd(ctx, a, title) {
  const { s, base, prefix } = ctx;
  const code = currencyCode(a.currency);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Offer',
        name: title,
        url: base + a.url,
        price: code ? a.price : undefined,
        priceCurrency: code || undefined,
        availability: 'https://schema.org/InStock',
        seller: { '@type': 'RealEstateAgent', '@id': base + prefix + '/#agent', name: s.name, url: base + prefix + '/' },
        itemOffered: {
          '@type': a.type === 'commercial' || a.type === 'land' ? 'Place' : 'Apartment',
          name: `${a.roomsLabel}, ${a.area} ${a.unit}${a.title ? ' — ' + a.title : ''}`,
          numberOfRooms: a.type === 'commercial' || a.type === 'land' ? undefined : (a.rooms || undefined),
          floorSize: { '@type': 'QuantitativeValue', value: a.type === 'land' ? a.area * 100 : a.area, unitCode: 'MTK' }, // сотка = 100 м²
          address: a.address || undefined,
          image: a.photos.length ? a.photos.map(ph => base + ph.src) : undefined,
          description: a.details || undefined,
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: s.name, item: base + prefix + '/' },
          { '@type': 'ListItem', position: 2, name: `${a.roomsLabel}, ${a.area} ${a.unit}`, item: base + a.url },
        ],
      },
    ],
  };
}

// ---------- Главная: содержимое сразу в HTML ----------
// Роботы Instagram, Facebook, Google и Яндекса не запускают скрипты. Раньше они видели пустой заголовок, ни одной квартиры
// и одни кнопки WhatsApp — для автоматической проверки это похоже на «ловушку для заявок». Теперь весь текст и карточки
// квартир приходят в коде страницы; скрипт app.js потом перерисовывает их так же, как раньше (фильтр, анимации).
const textLines = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
const textBlocks = t => String(t || '').split(/\n\s*\n/).map(b => textLines(b)).filter(b => b.length);
// Вставить HTML внутрь пустого элемента с этим id (в шаблоне views/index.html они пустые)
const fillId = (html, id, inner) => html.replace(new RegExp(`(<([a-z0-9]+)[^>]*\\bid="${id}"[^>]*>)\\s*(</\\2>)`), (m, open, tag, close) => open + inner + close);

// Наличные и участки — одна цена в $, без рассрочки
const isCash = a => a.type === 'cash' || a.type === 'land';

function serverCard(a, lang) {
  const c = a.currency;
  const photo = a.photos[0] ? `<img src="${a.photos[0].thumb}" alt="${esc(`${a.roomsLabel}, ${a.area} ${a.unit}`)}" loading="lazy">` : '<div class="ph"></div>';
  const price = a.installment
    ? `<div class="card-price"><b>${money(a.monthly, c)}</b><span>${t(lang, 'perMonth')}</span></div>`
    : `<div class="card-price"><b>${money(a.price, c)}</b><span>${t(lang, isCash(a) ? 'cashWord' : 'fullPay')}</span></div>`;
  const pay = a.installment
    ? `<p class="pay-line">${t(lang, 'payLineHtml', { down: money(a.down, c), monthly: money(a.monthly, c), n: a.months })}</p><div class="price-line">${esc(t(lang, 'priceLine', { x: money(a.price, c) }))}</div>`
    : '';
  return `<article class="card"><a class="card-link" href="${a.url}">
      <div class="card-photo">${photo}</div>
      <div class="card-body">${price}<div class="card-title">${a.roomsLabel}, ${a.area} ${a.unit}${a.title ? ` · ${esc(a.title)}` : ''}</div>
        ${a.address ? `<div class="card-addr">${ICONS.pin}${esc(a.address)}</div>` : ''}${pay}</div></a></article>`;
}

// Новость «Скоро»: фото, заголовок, текст и кнопка «Узнать первым» — клиент пишет менеджеру в WhatsApp
function newsCard(n, s, lang) {
  const text = t(lang, 'waNews', { title: n.title || n.text.slice(0, 80) });
  const href = s.whatsapp ? waLink(s.whatsapp, text) : '#';
  return `<article class="news-card">
      ${n.photo ? `<div class="news-photo"><img src="/uploads/${esc(n.photo)}.webp" alt="${esc(n.title)}" loading="lazy"></div>` : ''}
      <div class="news-body">
        ${n.title ? `<h3>${esc(n.title)}</h3>` : ''}
        ${n.text ? `<p class="news-text">${esc(n.text).replace(/\n/g, '<br>')}</p>
        <button type="button" class="news-more" aria-expanded="false" hidden>${t(lang, 'newsMore')}</button>` : ''}
        <a class="btn btn-wa news-btn" href="${esc(href)}" data-wa="news" target="_blank" rel="noopener">${WA_ICON}${t(lang, 'newsBtn')}</a>
      </div>
    </article>`;
}

// Специалист агентства: фото (или инициалы), имя, должность и своя кнопка WhatsApp
// (номер специалиста; не указан — номер агентства)
function teamCard(m, s, lang) {
  const phone = m.whatsapp || s.whatsapp;
  const initials = String(m.name || '').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  return `<article class="member">
      <div class="member-photo">${m.photo ? `<img src="/uploads/${esc(m.photo)}-t.webp" alt="${esc(m.name)}" loading="lazy">` : `<span>${esc(initials)}</span>`}</div>
      <div class="member-body">
        <h3>${esc(m.name)}</h3>
        ${m.role ? `<p>${esc(m.role)}</p>` : ''}
        ${phone ? `<a class="btn btn-wa member-btn" href="${esc(waLink(phone, t(lang, 'waTeam', { name: m.name, agency: s.name })))}" data-wa="team" target="_blank" rel="noopener">${WA_ICON}${t(lang, 'teamWa')}</a>` : ''}
      </div>
    </article>`;
}

// Удалить блок шаблона между <!--ИМЯ--> и <!--/ИМЯ-->
const dropBlock = (html, name) => html.replace(new RegExp(`<!--${name}-->[\\s\\S]*?<!--/${name}-->`), '');

function fillIndex(html, ctx, apartments) {
  const { s, lang } = ctx;
  // Тексты шаблона {{ключ}} — из словаря на языке страницы
  html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k.endsWith('Html') ? t(lang, k) : esc(t(lang, k))));
  // Новостей нет — блока «Скоро» на странице нет совсем
  const news = (Array.isArray(s.news) ? s.news : []).filter(n => n && (n.title || n.text));
  html = news.length ? fillId(html, 'news', news.map(n => newsCard(n, s, lang)).join('')) : dropBlock(html, 'NEWS');
  // Услуги: блоки «Заголовок\nТекст», разделённые пустой строкой. Ниже — призыв для владельцев «Продать или сдать».
  const services = textBlocks(s.services);
  const sell = String(s.sellTitle || '').trim();
  if (services.length || sell) {
    html = fillId(html, 'servicesList', services.map(([title, ...text]) =>
      `<div class="service"><h3>${esc(title)}</h3>${text.length ? `<p>${esc(text.join(' '))}</p>` : ''}</div>`).join(''));
    html = fillId(html, 'sell', sell ? `<div class="sell-text"><h3>${esc(sell)}</h3>${s.sellText ? `<p>${esc(s.sellText)}</p>` : ''}</div>
      ${s.whatsapp ? `<a class="btn btn-wa btn-lg" href="${esc(waLink(s.whatsapp, t(lang, 'waSell')))}" data-wa="sell" target="_blank" rel="noopener">${WA_ICON}${t(lang, 'sellBtn')}</a>` : ''}` : '');
    if (!services.length) html = html.replace(/<div class="services" id="servicesList"><\/div>/, '');
    if (!sell) html = html.replace(/<div class="sell" id="sell"><\/div>/, '');
  } else html = dropBlock(html, 'SERVICES');
  // Команда
  const team = (Array.isArray(s.team) ? s.team : []).filter(m => m && m.name);
  html = team.length ? fillId(html, 'teamList', team.map(m => teamCard(m, s, lang)).join('')) : dropBlock(html, 'TEAM');
  // Вакансии: блоки «Должность\nОписание»; у каждой кнопка «Хочу у вас работать»
  const jobs = textBlocks(s.vacancies);
  html = jobs.length ? fillId(html, 'jobsList', jobs.map(([title, ...text]) => `<div class="job">
      <div><h3>${esc(title)}</h3>${text.length ? `<p>${esc(text.join(' '))}</p>` : ''}</div>
      ${s.whatsapp ? `<a class="btn btn-wa" href="${esc(waLink(s.whatsapp, t(lang, 'waJob', { agency: s.name, title })))}" data-wa="job" target="_blank" rel="noopener">${WA_ICON}${t(lang, 'jobsBtn')}</a>` : ''}
    </div>`).join('')) : dropBlock(html, 'JOBS');

  const wa = s.whatsapp ? waLink(s.whatsapp, t(lang, 'waGeneral')) : '#';
  const role = String(s.role || '');
  html = fillId(html, 'heroKicker', esc(s.heroKicker || ''));
  html = fillId(html, 'heroTitle', esc(s.tagline || ''));
  html = fillId(html, 'heroPoints', textLines(s.heroPoints).map(x => `<li>${esc(x)}</li>`).join(''));
  html = fillId(html, 'heroPhoto', s.photo ? `<img src="${esc(s.photo)}" alt="${esc(s.name)}" fetchpriority="high">` : '');
  html = fillId(html, 'badgeName', esc(s.name));
  html = fillId(html, 'badgeRole', esc(role));
  html = fillId(html, 'cards', apartments.map(a => serverCard(a, lang)).join(''));
  html = fillId(html, 'steps', textLines(s.steps).map(x => `<li>${esc(x)}</li>`).join(''));
  html = fillId(html, 'docs', textLines(s.documents).map(x => `<li>${esc(x)}</li>`).join(''));
  html = fillId(html, 'aboutTitle', t(lang, 'aboutTitleHtml', { name: esc(s.name) }));
  html = fillId(html, 'aboutText', esc(s.about || ''));
  // Instagram — заметной кнопкой под «О нас» (ник вводится в кабинете, «Профиль» → «Контакты»)
  html = html.replace('<!--INSTA-->', s.instagram
    ? `<a class="insta-link" href="${esc(igLink(s))}" target="_blank" rel="noopener">${ICONS.insta}<span><small>${t(lang, 'myInstagram')}</small><b>${esc(igNick(s))}</b></span></a>`
    : '');
  html = fillId(html, 'officeAddr', esc(s.officeAddress || ''));
  if (s.officeLink) html = html.replace('<a class="office" id="office"', `<a class="office" id="office" href="${esc(s.officeLink)}"`);
  html = fillId(html, 'stats', textLines(s.stats).map(l => { const [v, t] = l.split('|').map(x => x.trim()); return `<div class="stat"><div><b>${esc(v)}</b><span>${esc(t || '')}</span></div></div>`; }).join(''));
  html = fillId(html, 'reviews', textBlocks(s.reviews).map(([head, ...text]) => {
    const [who, date] = head.split('|').map(x => x.trim());
    return `<figure class="review"><blockquote>${esc(text.join(' '))}</blockquote><figcaption><span><b>${esc(who)}</b>${date ? `<small>${esc(date)}</small>` : ''}</span></figcaption></figure>`;
  }).join(''));
  html = fillId(html, 'faq', textBlocks(s.faq).map(([q, ...a]) => `<details><summary>${esc(q)}</summary><p>${esc(a.join(' '))}</p></details>`).join(''));
  html = fillId(html, 'ctaTitle', esc(s.ctaTitle || ''));
  html = fillId(html, 'ctaText', esc(s.ctaText || ''));
  // Настоящие ссылки WhatsApp вместо «#»
  html = html.replace('href="#" class="btn btn-wa btn-lg" id="ctaWa"', `href="${esc(wa)}" class="btn btn-wa btn-lg" id="ctaWa"`);
  return html;
}

function renderIndex(ctx, apartments) {
  const { s, base, prefix } = ctx;
  const tpl = fs.readFileSync(INDEX_TPL, 'utf8');
  const description = t(ctx.lang, 'metaIndex', { tagline: s.tagline });
  return fillIndex(tpl, ctx, apartments)
    .replace('<!--HEAD-->', head({ title: `${s.name} — ${s.tagline}`, description, image: s.photo ? base + s.photo.replace(/\.webp$/, '-og.jpg') : null, url: base + prefix + '/', settings: s, ld: agentLd(ctx, apartments), lang: ctx.lang }))
    .replace('<!--HEADER-->', header(ctx, true))
    .replace('<!--LOGO:pl-->', s.logo ? logo(s, 'pl-logo', 160, 97) : `<div class="pl-name">${esc(s.name)}</div>`)
    .replace('<!--PL-CAP-->', esc(s.heroKicker || s.role || ''))
    .replace('<!--LOGO:badge-->', logo(s, '', 52, 31))
    .replace('<!--LOGO:office-->', logo(s, 'office-logo', 96, 58))
    .replace('<!--FOOTER-->', footer(ctx) + tabbar(ctx, { home: true, active: 'home' }))
    .replace('<!--SCRIPTS-->', scripts(ctx, 'home', { apartments }, ['common', 'app']));
}

function miniCard(a, lang) {
  return `<a class="mini" href="${a.url}">
  ${a.photos[0] ? `<img src="${a.photos[0].thumb}" alt="" loading="lazy">` : '<div class="ph"></div>'}
  <div><b>${a.roomsLabel}, ${a.area} ${a.unit}</b><span>${a.installment ? `${money(a.monthly, a.currency)} ${t(lang, 'perMonth')}` : money(a.price, a.currency)}</span></div></a>`;
}

function renderApartment(ctx, a, similar) {
  const { s, base, lang } = ctx;
  const L = (k, v) => t(lang, k, v);
  const cur = a.currency;
  const title = `${a.roomsLabel}, ${a.area} ${a.unit} — ${money(a.price, cur)}${a.installment ? L('titleFromMonthly', { x: money(a.monthly, cur) }) : ''}`;
  const desc = [a.title, a.address, a.installment ? L('descDown', { x: money(a.down, cur), n: a.months }) : isCash(a) ? L('payCash') : L('fullPay')].filter(Boolean).join(' · ');
  const wa = waLink(s.whatsapp, a.waText);
  const ppmLabel = a.type === 'land' ? 'ppmSot' : 'ppmM2';

  const gallery = a.photos.length
    ? a.photos.map((p, i) => `<img src="${p.src}" alt="${esc(`${a.roomsLabel}, ${a.area} ${a.unit}${a.title ? ', ' + a.title : ''} — ${L('photoN', { i: i + 1 })}`)}" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}>`).join('')
    : '<div class="ph big"></div>';

  // Калькулятор: клиент может внести больше минимального взноса — платёж в месяц уменьшится
  const calc = a.installment ? `
    <section class="calc" id="calc">
      <!-- Сначала клиент выбирает взнос, под ним сразу видит платёж в месяц -->
      <div class="calc-down">
        <div class="field-head"><label for="cDownInput">${L('calcDown')}</label><span class="calc-min">${L('calcMin', { x: money(a.down, cur) })}</span></div>
        <div class="calc-input"><input id="cDownInput" type="text" inputmode="numeric" value="${money(a.down, '')}" aria-label="${L('calcDown')}"><span>${esc(cur)}</span></div>
        <input type="range" id="cDown" class="range" aria-label="${L('calcDown')}">
        <p class="calc-hint" id="cHint">${L('calcHint')}</p>
      </div>
      <div class="calc-main" aria-live="polite">
        <span>${L('calcMonthly')}</span>
        <b id="cMonthly">${money(a.monthly, cur)}</b>
        <small id="cTerm">${L('calcTerm', { n: a.months })}</small>
      </div>
      <dl class="calc-rows">
        <div><dt>${L('price')}</dt><dd>${money(a.price, cur)}</dd></div>
        <div><dt>${L('calcRest')}</dt><dd id="cRest">${money(a.price - a.down, cur)}</dd></div>
        <div><dt>${L('calcPpm')}</dt><dd>${money(a.pricePerM2, cur)}</dd></div>
      </dl>
      <p class="calc-note">${L('calcNote')}</p>
      ${a.cash ? `
      <div class="cash-offer" id="cashOffer">
        <span class="co-badge">${L('coBadge')}</span>
        <div class="co-head"><span>${L('coHead')}</span><b>${money(a.cash.price, cur)}</b></div>
        <p class="co-line">${L('coLine', { ppm: money(a.cash.ppm, cur), old: money(a.pricePerM2, cur), d: money(a.cash.discount, cur) })}</p>
        <p class="co-save"><span class="co-mark">${L('coSaveHtml', { x: money(a.cash.savings, cur) })}</span></p>
        <p class="co-hint" id="coHint">${L('coHint', { x: money(a.cash.price, cur), own: L(a.type === 'commercial' ? 'ownCommercial' : 'ownApartment') })}</p>
        <a class="btn btn-wa co-btn" id="cashWa" href="${esc(waLink(s.whatsapp, a.cash.waText))}" data-wa="apartment-cash" data-id="${a.id}" target="_blank" rel="noopener">${WA_ICON}${L('wantCash')}</a>
      </div>` : ''}
    </section>` : `
    <section class="calc">
      <div class="calc-main"><span>${L(isCash(a) ? 'priceCash' : 'priceFull')}</span><b>${money(a.price, cur)}</b><small>${L(ppmLabel, { x: money(a.pricePerM2, cur) })}</small></div>
    </section>`;

  // Этаж и этажность — в строке под заголовком. Отдельного блока «Характеристики» нет: он повторял
  // заголовок, адрес, эту строку и срок рассрочки из расчёта.
  const floorInfo = a.floorFrom ? L('floorFromOf', { f: a.floorFrom, of: a.floors ? L('floorOf', { n: a.floors }) : '' }) : a.floors ? L('houseFloors', { n: a.floors }) : '';

  return `<!doctype html><html lang="${L('htmlLang')}"><head>
${head({ title, description: desc, image: a.photos[0] ? base + a.photos[0].og : null, url: base + a.url, settings: s, ld: apartmentLd(ctx, a, title), lang })}
</head><body class="apt-page">
${header(ctx)}
<main class="wrap apt">
  <div class="gallery-wrap">
    <div class="gallery" id="gallery">${gallery}</div>
    ${a.photos.length > 1 ? `<div class="gallery-count" id="gcount">1 / ${a.photos.length}</div>` : ''}
    <div class="tags">${a.tags.map(x => `<span class="tag${(x === 'Скидка' || x === 'Арзандатуу') ? ' tag-sale' : x === L('tagInstallment') ? ' tag-inst' : ''}">${esc(x)}</span>`).join('')}</div>
  </div>
  <div class="apt-info">
    ${a.title ? `<div class="apt-complex">${esc(a.title)}</div>` : ''}
    <h1>${a.roomsLabel}, ${a.area} ${a.unit}</h1>
    ${a.address ? `<div class="addr">${ICONS.pin}${esc(a.address)}</div>` : ''}
    <div class="feats">
      ${a.type === 'land' ? '' : `<span>${ICONS.bed}${a.roomsLabel}</span>`}<span>${ICONS.area}${a.area} ${a.unit}</span>
      ${floorInfo ? `<span>${ICONS.floor}${floorInfo}</span>` : ''}
      ${a.handover ? `<span>${ICONS.calendar}${esc(handoverLabel(a.handover, lang))}</span>` : ''}
    </div>
    ${a.floorFrom && a.type !== 'land' ? `<p class="floor-note">${L('floorChoice')}</p>` : ''}
    ${calc}
    <a class="btn btn-wa btn-lg apt-cta" id="aptWa" href="${esc(wa)}" data-wa="apartment" data-id="${a.id}" target="_blank" rel="noopener">${WA_ICON}${L({ commercial: 'wantCommercial', land: 'wantLand' }[a.type] || 'wantApartment')}</a>
  </div>
  <!-- Детали и карта: на телефоне — после цены (кнопка встаёт между ними, см. common.js), на ноутбуке — под фото (см. .apt-more в style.css) -->
  <div class="apt-more">
    ${a.details ? `<section class="details"><h2>${L('details')}</h2><p>${esc(a.details).replace(/\n/g, '<br>')}</p>${glossary(a.details, lang)}</section>` : ''}
    ${a.map.embed ? `<section class="map"><h2>${L('onMap')}</h2>
      <iframe loading="lazy" title="${L('map')}" src="${esc(a.map.embed)}" referrerpolicy="no-referrer-when-downgrade"></iframe>
    </section>` : ''}
  </div>
  ${similar.length ? `<section class="similar"><h2>${L({ commercial: 'similarCommercial', land: 'similarLand' }[a.type] || 'similarApartment')}</h2><div class="mini-list">${similar.map(x => miniCard(x, lang)).join('')}</div></section>` : ''}
</main>
${footer(ctx)}
${tabbar(ctx, { active: 'catalog', waText: a.waText, waPlace: 'apartment-tab', aptId: a.id })}
${scripts(ctx, 'apt', { apartment: a, base }, ['common', 'apartment'])}
</body></html>`;
}

function renderGone(ctx, similar) {
  const { s, base, prefix, lang } = ctx;
  return `<!doctype html><html lang="${t(lang, 'htmlLang')}"><head>
${head({ title: t(lang, 'goneTitle', { name: s.name }), description: t(lang, 'goneDesc'), url: base + prefix + '/', settings: s, lang })}
<meta name="robots" content="noindex">
</head><body class="apt-page">
${header(ctx)}
<main class="wrap gone">
  <h1>${t(lang, 'goneH1')}</h1>
  <p>${t(lang, 'goneText')}</p>
  ${similar.length ? `<div class="mini-list">${similar.map(x => miniCard(x, lang)).join('')}</div>` : ''}
  <a class="btn btn-wa btn-lg" href="${esc(waLink(s.whatsapp, t(lang, 'waGone')))}" data-wa="gone" target="_blank" rel="noopener">${WA_ICON}${t(lang, 'pickManually')}</a>
</main>
${footer(ctx)}
${tabbar(ctx, { active: 'catalog' })}
${scripts(ctx, 'gone')}
</body></html>`;
}

function renderPrivacy(ctx) {
  const { s, base, prefix, lang } = ctx;
  return `<!doctype html><html lang="${t(lang, 'htmlLang')}"><head>
${head({ title: `${t(lang, 'privacy')} — ${s.name}`, description: t(lang, 'privacy'), url: `${base}${prefix}/privacy`, settings: s, lang })}
</head><body class="apt-page">
${header(ctx)}
<main class="wrap gone"><h1>${t(lang, 'privacy')}</h1><p>${esc(s.privacy).replace(/\n/g, '<br>')}</p></main>
${footer(ctx)}
${tabbar(ctx)}
${scripts(ctx, 'privacy')}
</body></html>`;
}

// Адреса нет на сайте: опечатка в ссылке или старая ссылка
function renderNotFound(ctx) {
  const { s, base, prefix, lang } = ctx;
  return `<!doctype html><html lang="${t(lang, 'htmlLang')}"><head>
${head({ title: `${t(lang, 'notFoundTitle')} — ${s.name}`, description: t(lang, 'notFoundText'), url: base + prefix + '/', settings: s, lang })}
<meta name="robots" content="noindex">
</head><body class="plain-page">
<main class="wrap plain"><div class="plain-box">
  <div class="kicker">${esc(s.name)}</div>
  <h1>${t(lang, 'notFoundTitle')}</h1>
  <p>${t(lang, 'notFoundText')}</p>
  <p><a class="btn" href="${prefix}/">${t(lang, 'toHome')}</a></p>
</div></main>
</body></html>`;
}

module.exports = { renderIndex, renderApartment, renderGone, renderPrivacy, renderNotFound, roomsLabel };
