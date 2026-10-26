// Новая база для первого запуска (если базы ещё нет и перенос с kvartiry.asia не делали).
//   node lib/seed.js           — пустой сайт: настройки по умолчанию, вход в кабинет
//   node lib/seed.js --demo    — то же + демо-квартиры с рисованными фото (для проверки на компьютере)
// Существующую базу не перезаписывает без --force.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const db = require('./db');
const auth = require('./auth');
const { defaultSettings } = require('./site');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// Рассрочка (сом): [ЖК, комнаты, м², сом за м², мин. взнос, срок мес., от этажа, этажность, метки, адрес, оттенок фото]
const newBuild = [
  ['ЖК «Восток»', 1, 42, 92000, 1200000, 30, 3, 12, [], 'Бишкек, ул. Ахунбаева 120', 210],
  ['ЖК «Восток»', 2, 65, 88000, 1700000, 36, 5, 12, ['Скидка'], 'Бишкек, ул. Ахунбаева 120', 210],
  ['ЖК «Ала-Тоо Резиденс»', 0, 28, 98000, 800000, 24, 2, 9, [], 'Бишкек, ул. Токтогула 200', 25],
  ['ЖК «Парк Сити»', 3, 92, 90000, 2500000, 36, 7, 16, [], 'Бишкек, ул. Раззакова 50', 145],
  ['ЖК «Южный»', 4, 125, 85000, 3200000, 36, 3, 10, ['Скидка'], 'Бишкек, ул. Ахунбаева 98', 35],
  ['ЖК «Ала-Тоо Резиденс»', 1, 38, 95000, 1000000, 24, 6, 9, [], 'Бишкек, ул. Токтогула 200', 25],
];
// Наличные ($): [название, комнаты, м², цена $, этаж, этажность, метки, адрес, оттенок]
const resale = [
  ['Дом у парка', 2, 60, 62000, 4, 9, ['С ремонтом'], 'Бишкек, мкр. Джал', 300],
  ['Сталинка в центре', 3, 80, 85000, 2, 4, [], 'Бишкек, ул. Киевская', 190],
];
function svg(hue, label, variant) {
  const w = 1200, h = 800;
  let blds = '';
  const n = 5 + variant;
  for (let i = 0; i < n; i++) {
    const bw = 110 + ((i * 53 + variant * 31) % 90);
    const bh = 260 + ((i * 97 + variant * 41) % 330);
    const x = i * (w / n) + ((i * 17) % 30);
    const y = h - bh;
    const light = 88 - (i % 3) * 6;
    blds += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="hsl(${hue},18%,${light}%)"/>`;
    for (let wy = y + 24; wy < h - 30; wy += 38) {
      for (let wx = x + 16; wx < x + bw - 24; wx += 30) {
        const lit = (wx * 7 + wy * 3 + variant) % 5 === 0;
        blds += `<rect x="${wx}" y="${wy}" width="14" height="20" rx="2" fill="${lit ? `hsl(42,90%,70%)` : `hsl(${hue},30%,${light - 22}%)`}"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="hsl(${hue},55%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},60%,86%)"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>
<circle cx="${950 - variant * 200}" cy="170" r="70" fill="hsl(45,100%,92%)" opacity=".85"/>
${blds}
</svg>`;
}

async function makePhoto(hue, label, variant) {
  const name = crypto.randomBytes(8).toString('hex');
  const img = sharp(Buffer.from(svg(hue, label, variant)));
  await img.clone().webp({ quality: 78 }).toFile(path.join(UPLOAD_DIR, `${name}.webp`));
  await img.clone().resize({ width: 640 }).webp({ quality: 72 }).toFile(path.join(UPLOAD_DIR, `${name}-t.webp`));
  await img.clone().resize({ width: 1200, height: 630, fit: 'cover' }).jpeg({ quality: 78 }).toFile(path.join(UPLOAD_DIR, `${name}-og.jpg`));
  return name;
}

const DETAILS = 'Монолитный каркас, панорамные окна, черновая отделка. Закрытый двор, детская площадка, подземный паркинг.';

async function photos(hue, label) {
  const list = [];
  for (let v = 0; v < 3; v++) list.push(await makePhoto(hue, label, v));
  return list;
}

async function demoApartments() {
  const list = [];
  let t = Date.now();
  const at = () => new Date(t -= 3600e3).toISOString();
  for (const [title, rooms, area, pricePerM2, down, months, floorFrom, floors, tags, address, hue] of newBuild) {
    list.push({ id: db.newId(), type: 'installment', title, rooms, area, pricePerM2, down, months, price: 0,
      cashDiscount: Math.round(pricePerM2 * 0.08 / 1000) * 1000, // демо: ~8% скидки за наличные
      floorFrom, floors, address, tags, handover: 'IV квартал 2027', photos: await photos(hue, title), details: DETAILS, createdAt: at() });
  }
  for (const [title, rooms, area, price, floorFrom, floors, tags, address, hue] of resale) {
    list.push({ id: db.newId(), type: 'cash', title, rooms, area, pricePerM2: 0, down: 0, months: 0, price,
      floorFrom, floors, address, tags, photos: await photos(hue, title), details: 'Квартира на вторичном рынке, оплата наличными.', createdAt: at() });
  }
  return list;
}

// Пароль: из ADMIN_PASSWORD или сгенерированный (печатается в консоли один раз)
async function seed({ demo = false } = {}) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const password = process.env.ADMIN_PASSWORD || auth.generatePassword();
  const data = {
    secret: crypto.randomBytes(32).toString('hex'),
    settings: defaultSettings(),
    user: { id: db.newId(), login: process.env.ADMIN_LOGIN || 'admin', ...auth.hashPassword(password), defaultPassword: false, createdAt: new Date().toISOString() },
    apartments: demo ? await demoApartments() : [],
    done: { handoverTags: new Date().toISOString(), kyFill: new Date().toISOString() },
  };
  db.write(data);
  console.log(`Новая база создана${demo ? ` (демо-квартир: ${data.apartments.length})` : ''}.`);
  console.log(`Вход в кабинет: логин ${data.user.login}, пароль ${process.env.ADMIN_PASSWORD ? 'из ADMIN_PASSWORD' : password}`);
}
module.exports = seed;

if (require.main === module) {
  if (db.exists() && !process.argv.includes('--force')) {
    console.log('База уже есть (data/db.json). Перезаписать: node lib/seed.js --force');
  } else {
    if (db.exists()) db.backup();
    seed({ demo: process.argv.includes('--demo') }).catch(e => { console.error(e); process.exit(1); });
  }
}
