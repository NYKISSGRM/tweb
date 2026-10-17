// Считает версию APK для CI и пишет её в $GITHUB_OUTPUT (name, code, tag).
// Тег android-v1.2.3 -> name 1.2.3; запуск вручную -> input version или 0.0.0-dev.
// versionCode = номер запуска workflow (растёт монотонно, нужен для обновления поверх).
import {appendFileSync} from 'node:fs';

const ref = process.env.GITHUB_REF || '';
const isTag = process.env.GITHUB_REF_TYPE === 'tag' && ref.startsWith('refs/tags/android-v');
let name = (process.env.INPUT_VERSION || '').trim() || '0.0.0-dev';
let tag = '';

if(isTag) {
  tag = ref.slice('refs/tags/'.length);
  name = tag.slice('android-v'.length);
}

if(!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$/.test(name)) {
  console.error(`Некорректная версия: ${name}`);
  process.exit(1);
}

const code = Number(process.env.GITHUB_RUN_NUMBER || '1');
if(!Number.isInteger(code) || code < 1 || code > 2100000000) {
  console.error(`Некорректный versionCode: ${code}`);
  process.exit(1);
}

const out = `name=${name}\ncode=${code}\ntag=${tag}\n`;
if(process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
else process.stdout.write(out);
