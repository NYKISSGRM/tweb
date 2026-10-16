// NYKISS Gram — чистые функции профиля (без DOM): деньги, даты по МСК, график, прогресс достижений.
// Вынесено из profile.ts, чтобы это можно было проверить тестом.

export type Money = number;

/** $70, $70.5, $1 234: целые без копеек, дробные с двумя знаками. */
export function fmtMoney(v: Money): string {
  const n = Number(v) || 0;
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  const s = (whole ? Math.round(n) : n).toLocaleString('ru-RU', {minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2});
  return '$' + s.replace(/ | /g, ' ');
}

const MSK = 'Europe/Moscow';

/** «16 окт, 14:22» по Москве. Сервер отдаёт ISO; без пояса считаем время UTC. */
export function fmtMskTime(iso: string | null | undefined): string {
  if(!iso) return '';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
  if(isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {timeZone: MSK, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}).format(d);
}

/** «11 октября» для даты YYYY-MM-DD (московские сутки: берём полдень UTC, чтобы пояс не сдвинул число). */
export function fmtMskDay(day: string | null | undefined): string {
  if(!day || !/^\d{4}-\d\d-\d\d$/.test(day)) return '';
  return new Intl.DateTimeFormat('ru-RU', {timeZone: 'UTC', day: 'numeric', month: 'long'}).format(new Date(day + 'T12:00:00Z'));
}

/** Процент выполнения достижения 0..100. target 0/нет → 0. */
export function achPct(current: number, target: number | null | undefined): number {
  if(!target || target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((Number(current) || 0) / target * 100)));
}

/** Точки линии для SVG: values → «x,y x,y …» в рамке w×h с отступом pad. Все нули дают ровную линию внизу. */
export function sparkPoints(values: number[], w: number, h: number, pad = 3): string {
  if(!values.length) return '';
  const max = Math.max(...values, 0);
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => {
    const x = pad + i * step;
    const y = max > 0 ? h - pad - (Math.max(0, v) / max) * (h - pad * 2) : h - pad;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

/** «Серия 5 дн.» / «Серия 1 день»: склонение для подписей. */
export function daysWord(n: number): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if(a > 10 && a < 20) return 'дней';
  if(b === 1) return 'день';
  if(b >= 2 && b <= 4) return 'дня';
  return 'дней';
}
