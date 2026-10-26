// Перенос сайта одного менеджера с kvartiry.asia в этот проект.
// Из базы kvartiry.asia берутся ТОЛЬКО его настройки (профиль, тексты, новости), его квартиры и его вход
// в кабинет (логин и тот же пароль — пароль хранится как хэш, сам пароль скрипт не видит).
// Чужие менеджеры, оплата, лимиты и настройки сервиса не переносятся. Файл базы kvartiry.asia только читается.
//
//   node scripts/import-from-kvartiry.js --db <db.json с kvartiry.asia> [--slug aktilek]
//        [--uploads <папка uploads с kvartiry.asia>] [--events <папка data/events с kvartiry.asia>]
//        [--dry-run] [--force]
//
//   --db       копия базы kvartiry.asia (обязательно)
//   --slug     адрес сайта менеджера на kvartiry.asia (по умолчанию aktilek)
//   --uploads  папка с фото kvartiry.asia — его фото копируются в uploads/ этого проекта
//   --events   папка аналитики kvartiry.asia — его посещения и заявки копируются в data/events/
//   --dry-run  только показать, что будет перенесено, ничего не записывать
//   --force    заменить уже существующую базу этого сайта (перед заменой делается копия в data/backups/)
//
// Всегда пишет data/import-files.txt — список файлов фото, которые нужны с сервера kvartiry.asia.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(ROOT, 'uploads');

function args() {
  const out = { slug: 'aktilek' };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--dry-run') out.dryRun = true;
    else if (k === '--force') out.force = true;
    else if (['--db', '--slug', '--uploads', '--events'].includes(k)) out[k.slice(2)] = a[++i];
    else { console.error(`Непонятный параметр: ${k}`); process.exit(1); }
  }
  if (!out.db) {
    console.error('Укажите базу kvartiry.asia: node scripts/import-from-kvartiry.js --db C:\\Users\\arlen\\kvartiry-backups\\db-fresh.json');
    process.exit(1);
  }
  return out;
}

// Имена файлов на диске для фото из базы: квартира хранит «a1b2…» (16 знаков) → три размера
const PHOTO_RE = /^[0-9a-f]{16}$/;
const photoFiles = name => [`${name}.webp`, `${name}-t.webp`, `${name}-og.jpg`];
// Фото и логотип профиля хранятся как «/uploads/a1b2….webp»
function profileFiles(url, withSizes) {
  const m = /^\/uploads\/([0-9a-f]{16})\.webp$/.exec(String(url || ''));
  if (!m) return [];
  return withSizes ? photoFiles(m[1]) : [`${m[1]}.webp`];
}

function main() {
  const o = args();
  const src = JSON.parse(fs.readFileSync(o.db, 'utf8'));
  if (!Array.isArray(src.realtors)) { console.error('Это не база kvartiry.asia (нет списка менеджеров).'); process.exit(1); }

  const slug = String(o.slug).toLowerCase();
  const r = src.realtors.find(x => x.slug === slug) || src.realtors.find(x => (x.oldSlugs || []).includes(slug));
  if (!r) {
    console.error(`На kvartiry.asia нет сайта «/${slug}». Есть: ${src.realtors.map(x => '/' + x.slug).join(', ')}`);
    process.exit(1);
  }
  const u = (src.users || []).find(x => x.realtorId === r.id);
  if (!u) { console.error('У этого сайта нет входа в кабинет — перенести нельзя.'); process.exit(1); }

  // Настройки: всё, кроме полей старого раздела счётчиков (там мог оказаться пароль от браузера)
  const settings = JSON.parse(JSON.stringify(r.settings || {}));
  for (const k of ['gaId', 'ymId', 'pixelId', 'tgToken', 'tgChat']) delete settings[k];

  // Квартиры: без привязки к менеджеру и без пометки «скопировано у владельца»
  const apartments = (src.apartments || []).filter(a => a.realtorId === r.id).map(a => {
    const c = JSON.parse(JSON.stringify(a));
    delete c.realtorId;
    delete c.copiedFrom;
    return c;
  });

  // Нужные файлы фото
  const files = new Set();
  for (const a of apartments) for (const p of a.photos || []) if (PHOTO_RE.test(p)) photoFiles(p).forEach(f => files.add(f));
  for (const n of settings.news || []) if (PHOTO_RE.test(n.photo || '')) photoFiles(n.photo).forEach(f => files.add(f));
  profileFiles(settings.photo, true).forEach(f => files.add(f));
  profileFiles(settings.logo, false).forEach(f => files.add(f));

  const data = {
    secret: crypto.randomBytes(32).toString('hex'), // новый ключ сессий: входы с kvartiry.asia здесь не действуют
    settings,
    user: { id: u.id, login: u.login, salt: u.salt, hash: u.hash, defaultPassword: !!u.defaultPassword, createdAt: u.createdAt || new Date().toISOString() },
    apartments,
    // Разовые переделки kvartiry.asia, которые там уже прошли, здесь не повторяются
    done: { ...(src.done || {}) },
    importedFrom: { site: `kvartiry.asia/${r.slug}`, at: new Date().toISOString() },
  };

  const photoCount = apartments.reduce((n, a) => n + (a.photos || []).length, 0);
  console.log(`Сайт /${r.slug}: «${settings.name}», вход в кабинет — логин ${u.login} (пароль прежний)`);
  console.log(`Квартир: ${apartments.length}, фото в квартирах: ${photoCount}, новостей: ${(settings.news || []).length}`);
  console.log(`Своё фото: ${settings.photo ? 'есть' : 'нет'}, логотип: ${settings.logo ? 'есть' : 'нет'}, WhatsApp: ${settings.whatsapp || 'не указан'}`);
  console.log(`Файлов фото нужно с сервера: ${files.size}`);
  if (o.dryRun) { console.log('\nПроверка (--dry-run): ничего не записано.'); return; }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'import-files.txt'), [...files].sort().join('\n') + '\n');
  console.log(`Список файлов: ${path.join(DATA_DIR, 'import-files.txt')}`);

  // База этого сайта: не затираем молча
  if (fs.existsSync(DB_FILE)) {
    if (!o.force) {
      console.error(`\nБаза этого сайта уже есть: ${DB_FILE}\nЗаменить её перенесёнными данными — добавьте --force (перед заменой будет копия).`);
      process.exit(1);
    }
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const copy = path.join(dir, `before-import-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.copyFileSync(DB_FILE, copy);
    console.log(`Копия прежней базы: ${copy}`);
  }
  fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(DB_FILE + '.tmp', DB_FILE);
  console.log(`База записана: ${DB_FILE}`);

  // Фото
  if (o.uploads) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    let copied = 0;
    const missing = [];
    for (const f of files) {
      const from = path.join(o.uploads, f);
      if (fs.existsSync(from)) { fs.copyFileSync(from, path.join(UPLOAD_DIR, f)); copied++; } else missing.push(f);
    }
    console.log(`Фото скопировано: ${copied} из ${files.size}`);
    if (missing.length) console.log(`Не найдены в ${o.uploads}:\n  ${missing.join('\n  ')}`);
  } else {
    console.log('Фото не копировались (нет --uploads): нужные файлы — в data/import-files.txt');
  }

  // Аналитика: только его события, без пометки менеджера
  if (o.events) {
    const outDir = path.join(DATA_DIR, 'events');
    fs.mkdirSync(outDir, { recursive: true });
    let n = 0;
    for (const f of fs.readdirSync(o.events).filter(x => /^\d{4}-\d{2}\.jsonl$/.test(x)).sort()) {
      const lines = [];
      for (const line of fs.readFileSync(path.join(o.events, f), 'utf8').split('\n')) {
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch (e) { continue; }
        if (ev.r !== r.id) continue;
        delete ev.r;
        lines.push(JSON.stringify(ev));
      }
      if (lines.length) { fs.writeFileSync(path.join(outDir, f), lines.join('\n') + '\n'); n += lines.length; }
    }
    console.log(`Аналитика: перенесено событий ${n}`);
  }
  console.log('\nГотово. Запуск сайта: npm start');
}

main();
