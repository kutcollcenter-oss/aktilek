// Новый пароль для входа в кабинет, если старый забыт. Пароль придумывается сам и печатается один раз.
// Сайт на время смены нужно остановить (иначе он перезапишет базу старой копией из памяти):
//   systemctl stop yurta && sudo -u yurta node scripts/set-password.js && systemctl start yurta
// Сменить и логин: node scripts/set-password.js --login newlogin
const fs = require('fs');
const path = require('path');
const auth = require('../lib/auth');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');
const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
if (!data.user) { console.error('В базе нет входа в кабинет — это не база этого сайта.'); process.exit(1); }

const i = process.argv.indexOf('--login');
if (i > 0) {
  const login = String(process.argv[i + 1] || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(login)) { console.error('Логин: 3–32 символа, латиница, цифры, точка, дефис'); process.exit(1); }
  data.user.login = login;
}

// Копия базы перед изменением
const dir = path.join(path.dirname(DB_FILE), 'backups');
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(DB_FILE, path.join(dir, `before-password-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));

const password = auth.generatePassword(12);
Object.assign(data.user, auth.hashPassword(password), { defaultPassword: false });
fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(data, null, 2));
fs.renameSync(DB_FILE + '.tmp', DB_FILE);
console.log(`Логин: ${data.user.login}\nНовый пароль: ${password}\nВсе старые входы на других устройствах закрыты.`);
