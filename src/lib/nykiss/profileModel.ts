// NYKISS Gram — чистые функции профиля (без DOM): деньги, склонение, московские сутки, строки для нативного профиля.

export type Money = number;

/** $70, $70.5, $1 234: целые без копеек, дробные с двумя знаками. */
export function fmtMoney(v: Money): string {
  const n = Number(v) || 0;
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  const s = (whole ? Math.round(n) : n).toLocaleString('ru-RU', {minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2});
  return '$' + s.replace(/ | /g, ' ');
}

const MSK = 'Europe/Moscow';

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
