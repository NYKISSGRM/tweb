// NYKISS Gram — «Профиль NYKISS»: мой ранг, огонёк, достижения, мои цифры и состав команды.
// Данные: GET /messenger/profile (по личному ключу). Ванильный оверлей, как nykissWeb.ts; весь текст
// ставится через textContent — данные с сервера не интерпретируются как HTML.
// Номер карты, смена ника и меню живут в мини-аппе («Полный профиль»); здесь витрина: ранг, огонёк, заработок, достижения, профиты, рекорды.

import Modes from '@config/modes';
import createFocusTrap, {FocusTrap} from '@helpers/dom/focusTrap';
import {getTeamMembers, isIdentityMismatch, IDENTITY_EVENT, teamApi} from '@lib/nykiss/team';
import {achPct, daysWord, fmtMoney, fmtMskDay, fmtMskTime, sparkPoints} from '@lib/nykiss/profileModel';

const ID = 'nykiss-profile-overlay';
const STYLE_ID = 'nykiss-profile-style';
const TITLE_ID = 'nykiss-profile-title';

type Streak = {
  state: string,
  current: number,
  best: number,
  tier?: number,
  tier_name?: string | null,
  freezes?: number,
  bonus_pp?: number,
  can_restore?: boolean,
  visible?: boolean,
  appear_day?: number,
  hours_left_today?: number,
  lost_streak_len?: number
};

type Ach = {name: string, description: string, slug?: string, at?: string | null, current?: number, target?: number | null};
type Period = {profits: number, earned: number};
type RecentProfit = {at: string | null, type: string, x: number, amount: number, payout: number};

// Блоки второй волны необязательны: старый сервер их не отдаёт, профиль просто рисует то, что пришло.
type Profile = {
  name: string,
  rank: {level: number, name: string, color: string} | null,
  rank_progress_pct: number,
  next_rank: {level: number, name: string, need: number} | null,
  streak: Streak,
  streak_next?: {name: string, threshold: number, days: number} | null,
  streak_days?: boolean[],
  achievements: {earned: Ach[], locked: Ach[]},
  stats: {profits_count: number, mammoths_count: number, total_earned: number},
  periods?: {today: Period, week: Period, month: Period},
  spark?: number[],
  recent?: RecentProfit[],
  records?: {best_day: {date: string, earned: number, profits: number} | null, best_profit: {payout: number, at: string} | null}
};

let trap: FocusTrap | undefined;
let inerted: HTMLElement[] = [];
let onIdentity: () => void = () => {};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text != null) e.textContent = text;
  return e;
}

// Строки с цифрами и датами берут направление по первой букве, а не у страницы: «640 из 1000» не должно переворачиваться в RTL.
function auto<T extends HTMLElement>(e: T): T {
  e.dir = 'auto';
  return e;
}

function status(text: string, cls = 'nkp-muted'): HTMLElement {
  const e = el('p', cls, text);
  e.setAttribute('role', 'status');
  return e;
}

function injectStyle() {
  if(document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
#${ID}{position:fixed;inset:0;z-index:100000;background:rgba(7,8,7,.94);display:flex;justify-content:center;overflow-y:auto;
  font-family:Manrope,system-ui,sans-serif;color:#F3EEDF}
#${ID} .nkp{width:min(560px,100%);padding:max(20px,env(safe-area-inset-top)) 18px 40px;box-sizing:border-box;outline:0}
#${ID} h1,#${ID} h2{font-family:Fraunces,Georgia,serif;font-weight:600;margin:0}
#${ID} h1{font-size:26px;letter-spacing:.01em;outline:0}
#${ID} h2{font-size:15px;color:#C9A227;letter-spacing:.14em;text-transform:uppercase;margin:26px 0 10px}
#${ID} h2 small{font:inherit;color:#8f8872;letter-spacing:.04em;text-transform:none;margin-inline-start:6px}
#${ID} ul{list-style:none;margin:0;padding:0}
#${ID} .nkp-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
#${ID} .nkp-x{width:38px;height:38px;flex:none;border-radius:50%;border:1px solid rgba(201,162,39,.5);background:#15140d;color:#C9A227;font-size:20px;cursor:pointer}
#${ID} .nkp-card{background:#15140d;border:1px solid #241f12;border-radius:16px;padding:14px 16px}
#${ID} .nkp-warn{border-color:rgba(201,162,39,.6);color:#f6e8ba;margin-top:14px;font-size:13px;line-height:1.4}
#${ID} .nkp-warn p{margin:0}
#${ID} .nkp-pill{display:inline-block;padding:3px 10px;border-radius:99px;border:1px solid currentColor;font-size:12px;font-weight:700;margin-top:6px}
#${ID} .nkp-bar{height:6px;border-radius:99px;background:#241f12;margin-top:12px;overflow:hidden}
#${ID} .nkp-bar>i{display:block;height:100%;background:linear-gradient(90deg,#8a6b1d,#d8b451)}
.is-rtl #${ID} .nkp-bar>i{background:linear-gradient(270deg,#8a6b1d,#d8b451)}
#${ID} .nkp-muted{color:#9a927d;font-size:13px;margin:6px 0 0}
#${ID} .nkp-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
#${ID} .nkp-stat b{display:block;font-family:'JetBrains Mono',monospace;font-size:20px;color:#f6e8ba;unicode-bidi:isolate}
#${ID} .nkp-stat span{font-size:12px;color:#9a927d}
#${ID} .nkp-mate{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #1c180d}
#${ID} .nkp-dot{width:9px;height:9px;border-radius:50%;background:#3a3526;flex:none}
#${ID} .nkp-dot.on{background:#32a271}
#${ID} .nkp-mate small{color:#9a927d;margin-inline-start:auto;font-size:12px;unicode-bidi:isolate}
#${ID} .nkp-btn{margin-top:12px;width:100%;padding:12px 16px;border-radius:14px;border:0;cursor:pointer;font:800 13px/1 Manrope,system-ui,sans-serif;letter-spacing:.04em;color:#1a1405;background:linear-gradient(180deg,#e9c860,#C9A227)}
#${ID} .nkp-btn:disabled{opacity:.6;cursor:default}
#${ID} .nkp-btn.is-ghost{background:transparent;color:#d8b451;border:1px solid rgba(201,162,39,.6)}
#${ID} .nkp-fire-name{font-family:Fraunces,Georgia,serif;font-size:22px;color:#f6e8ba;margin:0}
#${ID} .nkp-fire-len{font-family:'JetBrains Mono',monospace;font-size:13px;color:#9a927d;margin:4px 0 0;unicode-bidi:isolate}
#${ID} .nkp-strip{display:flex;gap:5px;margin-top:12px}
#${ID} .nkp-strip i{flex:1;height:8px;border-radius:3px;background:#241f12}
#${ID} .nkp-strip i.on{background:linear-gradient(180deg,#e9c860,#a97d17)}
#${ID} .nkp-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
#${ID} .nkp-per b{display:block;font-family:'JetBrains Mono',monospace;font-size:18px;color:#f6e8ba;unicode-bidi:isolate}
#${ID} .nkp-per span,#${ID} .nkp-per small{display:block;font-size:12px;color:#9a927d}
#${ID} .nkp-spark{display:block;width:100%;height:56px;margin-top:12px}
#${ID} .nkp-spark polyline{fill:none;stroke:#d8b451;stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
#${ID} .nkp-sparkcap{display:flex;justify-content:space-between;font-size:11px;color:#8f8872;margin-top:4px}
#${ID} .nkp-ach{display:flex;flex-direction:column;gap:2px;padding:9px 0;border-bottom:1px solid #1c180d}
#${ID} .nkp-ach:last-child{border-bottom:0}
#${ID} .nkp-ach b{font-weight:700;font-size:14px;color:#d8b451}
#${ID} .nkp-ach.is-locked b{color:#b9b19a}
#${ID} .nkp-ach span{font-size:12px;color:#9a927d}
#${ID} .nkp-ach .nkp-bar{margin-top:6px;height:5px}
#${ID} .nkp-ach em{font-style:normal;font-family:'JetBrains Mono',monospace;font-size:11px;color:#8f8872;unicode-bidi:isolate}
#${ID} .nkp-pr{display:flex;align-items:baseline;gap:10px;padding:9px 0;border-bottom:1px solid #1c180d;font-size:13px}
#${ID} .nkp-pr:last-child{border-bottom:0}
#${ID} .nkp-pr b{font-family:'JetBrains Mono',monospace;color:#f6e8ba;margin-inline-start:auto;unicode-bidi:isolate}
#${ID} .nkp-pr small{color:#9a927d;font-size:12px;unicode-bidi:isolate}
#${ID} .nkp-rec{display:flex;justify-content:space-between;gap:12px;padding:8px 0;font-size:13px;border-bottom:1px solid #1c180d}
#${ID} .nkp-rec:last-child{border-bottom:0}
#${ID} .nkp-rec b{font-family:'JetBrains Mono',monospace;color:#f6e8ba;unicode-bidi:isolate}
#${ID} .nkp-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
:where(.a11y) #${ID} :is(button,[tabindex]):focus-visible{outline:2px solid #f6e8ba;outline-offset:2px}
`;
  document.head.appendChild(st);
}

function streakText(s: Streak): string {
  const appear = s.appear_day ?? 3;
  if(s.state === 'lost') {
    return s.can_restore ?
      `Огонёк погас${s.lost_streak_len ? ` (была серия ${s.lost_streak_len} дн.)` : ''}. Вернуть можно в течение 24 часов в мини-аппе: «Полный профиль».` :
      'Огонёк погас. Окно восстановления закрылось, зажги заново с профита.';
  }
  if(s.visible === false || !s.current || s.state === 'none') {
    const left = Math.max(0, appear - (s.current || 0));
    return `Огонёк загорится после ${appear} дней подряд с профитом${s.current ? `, осталось ${left}` : ''}.`;
  }
  const base = `Серия ${s.current} дн.${s.tier_name ? ' · ' + s.tier_name : ''} · рекорд ${s.best}.`;
  if(s.state === 'warning' || s.state === 'at_risk') {
    return `${base} Сегодня нужен профит${s.hours_left_today != null ? `, осталось ${s.hours_left_today} ч` : ''}.`;
  }
  if(s.state === 'ember') return `${base} Огонёк тлеет, кинь профит, пока не погас.`;
  return base;
}

function progressBar(pct: number, label: string): HTMLElement {
  const bar = el('div', 'nkp-bar'), fill = el('i');
  fill.style.width = `${pct}%`;
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', label);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', String(pct));
  bar.append(fill);
  return bar;
}

function fillFire(fire: HTMLElement, p: Profile) {
  const s = p.streak;
  fire.textContent = '';
  const active = s.visible !== false && s.current > 0 && s.state !== 'none' && s.state !== 'lost';
  if(!active) {
    fire.append(el('div', undefined, streakText(s)));
    return;
  }
  const name = el('p', 'nkp-fire-name', s.tier_name || 'Огонёк');
  name.dir = 'auto';
  fire.append(name, auto(el('p', 'nkp-fire-len', `Серия ${s.current} ${daysWord(s.current)} · рекорд ${s.best}`)));

  if(p.streak_days?.length) {
    const strip = el('div', 'nkp-strip');
    strip.setAttribute('role', 'img');
    const hit = p.streak_days.filter(Boolean).length;
    strip.setAttribute('aria-label', `Последние ${p.streak_days.length} дней: профит был в ${hit}`);
    p.streak_days.forEach(on => strip.append(el('i', on ? 'on' : '')));
    fire.append(strip);
  }

  if(p.streak_next) {
    const total = p.streak_next.threshold;
    const pct = Math.round(Math.max(0, Math.min(100, (s.current / total) * 100)));
    fire.append(progressBar(pct, `Прогресс до уровня «${p.streak_next.name}»`));
    const note = el('div', 'nkp-muted', `До «${p.streak_next.name}»: ${p.streak_next.days} ${daysWord(p.streak_next.days)}`);
    note.dir = 'auto';
    fire.append(note);
  }

  const extra = [
    s.freezes ? `заморозок: ${s.freezes}` : '',
    s.bonus_pp ? `бонус к выплате +${s.bonus_pp}%` : '',
    (s.state === 'warning' || s.state === 'at_risk') ? `сегодня нужен профит${s.hours_left_today != null ? `, осталось ${s.hours_left_today} ч` : ''}` : '',
    s.state === 'ember' ? 'огонёк тлеет, кинь профит, пока не погас' : ''
  ].filter(Boolean);
  if(extra.length) {
    const e = el('div', 'nkp-muted', extra.join(' · '));
    e.dir = 'auto';
    fire.append(e);
  }
}

function achRow(a: Ach, earned: boolean): HTMLElement {
  const li = el('li', 'nkp-ach' + (earned ? '' : ' is-locked'));
  const nm = el('b', undefined, a.name);
  nm.dir = 'auto';
  const desc = el('span', undefined, a.description);
  desc.dir = 'auto';
  li.append(nm, desc);
  if(earned) {
    const when = fmtMskTime(a.at);
    li.append(el('span', 'nkp-sr', 'получено'));
    if(when) li.append(auto(el('em', undefined, when)));
  } else {
    li.append(el('span', 'nkp-sr', 'не получено'));
    if(a.target) {
      const cur = Math.min(a.current ?? 0, a.target);
      li.append(progressBar(achPct(cur, a.target), `Прогресс: ${a.name}`), auto(el('em', undefined, `${cur} из ${a.target}`)));
    }
  }
  return li;
}

function periods(p: Profile): HTMLElement[] {
  if(!p.periods) return [];
  const out: HTMLElement[] = [el('h2', undefined, 'Заработок')];
  const card = el('div', 'nkp-card');
  const cols = el('div', 'nkp-cols');
  ([['Сегодня', p.periods.today], ['Неделя', p.periods.week], ['Месяц', p.periods.month]] as const).forEach(([k, v]) => {
    const c = el('div', 'nkp-per'), b = el('b', undefined, fmtMoney(v.earned));
    b.dir = 'ltr';
    c.append(b, el('span', undefined, k), auto(el('small', undefined, `${v.profits} проф.`)));
    cols.append(c);
  });
  card.append(cols);
  if(p.spark?.length && p.spark.some(v => v > 0)) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'nkp-spark');
    svg.setAttribute('viewBox', '0 0 300 56');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('dir', 'ltr');   // график идёт слева направо, как в записи: не зеркалится
    svg.setAttribute('aria-label', `Заработок по дням за ${p.spark.length} дней, всего ${fmtMoney(p.spark.reduce((a, b) => a + b, 0))}`);
    const line = document.createElementNS(NS, 'polyline');
    line.setAttribute('points', sparkPoints(p.spark, 300, 56));
    svg.append(line);
    const cap = el('div', 'nkp-sparkcap');
    cap.dir = 'ltr';
    cap.append(el('span', undefined, `${p.spark.length} дней назад`), el('span', undefined, 'сегодня'));
    card.append(svg, cap);
  }
  out.push(card);
  return out;
}

function recentBlock(p: Profile): HTMLElement[] {
  if(!p.recent?.length) return [];
  const list = el('ul', 'nkp-card');
  p.recent.forEach(r => {
    const row = el('li', 'nkp-pr');
    const kind = r.type === 'redeposit' ? `X${Math.max(2, r.x)}` : 'X1';
    const pay = el('b', undefined, '+' + fmtMoney(r.payout));
    pay.dir = 'ltr';
    row.append(auto(el('span', undefined, `${kind} · депозит ${fmtMoney(r.amount)}`)), auto(el('small', undefined, fmtMskTime(r.at))), pay);
    list.append(row);
  });
  return [el('h2', undefined, 'Последние профиты'), list];
}

function recordsBlock(p: Profile): HTMLElement[] {
  const rec = p.records;
  const rows: Array<[string, string]> = [];
  if(rec?.best_day) rows.push(['Лучший день', `${fmtMoney(rec.best_day.earned)} · ${fmtMskDay(rec.best_day.date)}`]);
  if(rec?.best_profit) rows.push(['Самый крупный профит', `+${fmtMoney(rec.best_profit.payout)}`]);
  if(p.streak.best) rows.push(['Лучшая серия', `${p.streak.best} ${daysWord(p.streak.best)}`]);
  if(!rows.length) return [];
  const card = el('div', 'nkp-card');
  rows.forEach(([k, v]) => {
    const r = el('div', 'nkp-rec'), b = auto(el('b', undefined, v));
    r.append(el('span', undefined, k), b);
    card.append(r);
  });
  return [el('h2', undefined, 'Рекорды'), card];
}

export function closeMyProfile() {
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener(IDENTITY_EVENT, onIdentity);
  trap?.deactivate();
  trap = undefined;
  inerted.forEach(e => { e.inert = false; });
  inerted = [];
  document.getElementById(ID)?.remove();
}

function onKey(e: KeyboardEvent) {
  if(e.key !== 'Escape' || Modes.a11y && e.defaultPrevented) return;
  if(Modes.a11y) e.preventDefault();
  e.stopPropagation();
  closeMyProfile();
}

function render(body: HTMLElement, p: Profile) {
  body.textContent = '';

  // предупреждение живое: team.ts может узнать о несовпадении аккаунта уже после открытия профиля
  const warn = el('div', 'nkp-card nkp-warn');
  warn.setAttribute('role', 'status');
  warn.append(el('p', undefined, 'Ты в Gram под другим Telegram-аккаунтом, чем в CRM. Метка на тебе у коллег не появится: зайди с основного.'));
  warn.hidden = !isIdentityMismatch();
  body.append(warn);
  window.removeEventListener(IDENTITY_EVENT, onIdentity);
  onIdentity = () => { warn.hidden = !isIdentityMismatch(); };
  window.addEventListener(IDENTITY_EVENT, onIdentity);

  // ранг: у воркера без ранга блок не показываем (иначе «Высший ранг» на пустом месте)
  if(p.rank) {
    const rankCard = el('div', 'nkp-card');
    rankCard.style.marginTop = '14px';
    const pill = el('span', 'nkp-pill', p.rank.name);
    pill.dir = 'auto';
    pill.style.color = /^#[0-9a-f]{3,8}$/i.test(p.rank.color) ? p.rank.color : '#C9A227';
    const pct = Math.round(Math.max(0, Math.min(100, p.rank_progress_pct || 0)));
    const bar = progressBar(pct, 'Прогресс до следующего ранга');
    const note = el('div', 'nkp-muted', p.next_rank ? `До «${p.next_rank.name}» осталось $${Math.ceil(p.next_rank.need)}` : 'Высший ранг');
    note.dir = 'auto';
    rankCard.append(pill, bar, note);
    body.append(rankCard);
  }

  body.append(el('h2', undefined, 'Огонёк'));
  const fire = el('div', 'nkp-card');
  fillFire(fire, p);
  body.append(fire);

  periods(p).forEach(n => body.append(n));

  const earned = p.achievements?.earned || [], locked = p.achievements?.locked || [];
  const h = el('h2', undefined, 'Достижения');
  if(earned.length + locked.length) h.append(el('small', undefined, `${earned.length} из ${earned.length + locked.length}`));
  body.append(h);
  if(earned.length + locked.length) {
    const list = el('ul', 'nkp-card');
    earned.forEach(a => list.append(achRow(a, true)));
    locked.forEach(a => list.append(achRow(a, false)));
    body.append(list);
  } else {
    body.append(status('Скоро: достижения появятся здесь, когда клуб их запустит.'));
  }

  recentBlock(p).forEach(n => body.append(n));
  recordsBlock(p).forEach(n => body.append(n));

  body.append(el('h2', undefined, 'Мои цифры'));
  const stats = el('div', 'nkp-card nkp-row');
  ([['Профитов', String(p.stats.profits_count)], ['Мамонтов', String(p.stats.mammoths_count)], ['Заработано', '$' + Math.round(p.stats.total_earned)]] as const)
  .forEach(([k, v]) => {
    const s = el('div', 'nkp-stat'), b = el('b', undefined, v);
    b.dir = 'ltr';
    s.append(b, el('span', undefined, k));
    stats.append(s);
  });
  body.append(stats);

  const mates = getTeamMembers().filter(m => !m.me);
  if(mates.length) {
    body.append(el('h2', undefined, 'Команда'));
    const list = el('ul', 'nkp-card');
    mates.sort((a, b) => Number(b.online) - Number(a.online) || (b.rank?.level ?? 0) - (a.rank?.level ?? 0)).forEach(m => {
      const row = el('li', 'nkp-mate');
      const dot = el('i', 'nkp-dot' + (m.online ? ' on' : ''));
      dot.setAttribute('aria-hidden', 'true');
      const nm = el('span', undefined, m.name);
      nm.dir = 'auto';
      const sub = el('small', undefined, [m.rank?.name, m.fire ? `серия ${m.fire.len} дн.` : ''].filter(Boolean).join(' · '));
      sub.dir = 'auto';
      row.append(dot, nm, el('span', 'nkp-sr', m.online ? 'в сети' : 'не в сети'), sub);
      list.append(row);
    });
    body.append(list);
  }

  // Номер карты, ник, рекорды и меню остаются в мини-аппе: не дублируем места правды.
  const full = el('button', 'nkp-btn is-ghost', 'Полный профиль в мини-аппе');
  full.type = 'button';
  full.style.marginTop = '22px';
  full.onclick = () => {
    closeMyProfile();
    import('@lib/nykiss/nykissWeb').then(({openNykissWeb}) => openNykissWeb());
  };
  body.append(full);
}

export async function openMyProfile() {
  if(document.getElementById(ID)) return;
  injectStyle();
  const opener = document.activeElement as HTMLElement | null;

  const root = el('div'); root.id = ID;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', TITLE_ID);
  const box = el('div', 'nkp');
  if(Modes.a11y) box.tabIndex = -1;
  root.append(box);
  root.addEventListener('click', e => { if(e.target === root) closeMyProfile(); });

  const top = el('div', 'nkp-top');
  const title = el('h1', undefined, 'Профиль NYKISS');
  title.id = TITLE_ID;
  title.dir = 'auto';
  const x = el('button', 'nkp-x');
  x.type = 'button';
  x.setAttribute('aria-label', 'Закрыть');
  const xi = el('span', undefined, '×');
  xi.setAttribute('aria-hidden', 'true');
  x.append(xi);
  x.onclick = closeMyProfile;
  top.append(title, x);
  box.append(top);
  const body = el('div');
  body.setAttribute('aria-busy', 'true');
  body.append(status('Загружаю…'));
  box.append(body);

  document.addEventListener('keydown', onKey, true);
  document.body.append(root);
  if(Modes.a11y) {
    inerted = Array.from(document.body.children).filter((c): c is HTMLElement => c !== root && c instanceof HTMLElement && !c.inert);
    inerted.forEach(c => { c.inert = true; });
  }
  trap = createFocusTrap(root);
  trap.activate(opener || undefined, x);

  const p: Profile | null = await teamApi('/messenger/profile');
  if(!root.isConnected) return;   // закрыли, пока грузилось
  body.removeAttribute('aria-busy');
  if(!p) {
    body.textContent = '';
    body.append(status('Не получилось загрузить. Проверь, что ключ подключён (меню N), и открой снова.'));
    return;
  }

  title.textContent = p.name;
  render(body, p);
}
