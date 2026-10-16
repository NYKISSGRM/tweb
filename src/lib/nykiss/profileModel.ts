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

/** Ключ московских суток «2026-10-16»: кэш профиля не должен переживать смену даты (сегодня обнуляется в 00:00 МСК). */
export function mskDayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {timeZone: MSK, year: 'numeric', month: '2-digit', day: '2-digit'}).format(now);
}

type EarningsSource = {
  rank?: {name: string, color?: string} | null,
  streak?: {current?: number, visible?: boolean, state?: string} | null,
  periods?: {today: {earned: number}, month: {earned: number}} | null
};

export type EarningsRows = {
  money: {today: string, month: string, aria: string} | null,
  rank: {name: string, color: string | null, fire: string | null} | null
};

/** Две строки для нативного профиля: «Заработок» и «Ранг · огонёк». Только то, что воркер и так видит; null, если показывать нечего. */
export function earningsRows(p: EarningsSource | null | undefined): EarningsRows | null {
  if(!p) return null;
  const money = p.periods ? {
    today: fmtMoney(p.periods.today?.earned ?? 0),
    month: fmtMoney(p.periods.month?.earned ?? 0),
    aria: `Заработок: сегодня ${fmtMoney(p.periods.today?.earned ?? 0)}, за месяц ${fmtMoney(p.periods.month?.earned ?? 0)}`
  } : null;
  const cur = p.streak && p.streak.visible !== false && p.streak.state !== 'none' && p.streak.state !== 'lost' ? p.streak.current || 0 : 0;
  const rank = p.rank || cur ? {
    name: p.rank?.name || 'Огонёк',
    color: p.rank && /^#[0-9a-f]{3,8}$/i.test(p.rank.color || '') ? p.rank.color : null,
    fire: cur ? `Огонёк: ${cur} ${daysWord(cur)}` : null
  } : null;
  return money || rank ? {money, rank} : null;
}
