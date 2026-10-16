// NYKISS Gram — «Профиль NYKISS»: мой ранг, огонёк, достижения, мои цифры и состав команды.
// Данные: GET /messenger/profile (по личному ключу). Ванильный оверлей, как nykissWeb.ts; весь текст
// ставится через textContent — данные с сервера не интерпретируются как HTML.
// Здесь только компактная карточка. Номер карты, смена ника, рекорды и меню живут в мини-аппе («Полный профиль»).

import Modes from '@config/modes';
import createFocusTrap, {FocusTrap} from '@helpers/dom/focusTrap';
import {getTeamMembers, isIdentityMismatch, IDENTITY_EVENT, teamApi} from '@lib/nykiss/team';

const ID = 'nykiss-profile-overlay';
const STYLE_ID = 'nykiss-profile-style';
const TITLE_ID = 'nykiss-profile-title';

type Streak = {
  state: string,
  current: number,
  best: number,
  tier_name?: string | null,
  can_restore?: boolean,
  visible?: boolean,
  appear_day?: number,
  hours_left_today?: number,
  lost_streak_len?: number
};

type Ach = {name: string, description: string};

type Profile = {
  name: string,
  rank: {level: number, name: string, color: string} | null,
  rank_progress_pct: number,
  next_rank: {level: number, name: string, need: number} | null,
  streak: Streak,
  achievements: {earned: Ach[], locked: Ach[]},
  stats: {profits_count: number, mammoths_count: number, total_earned: number}
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
#${ID} .nkp-chips{display:flex;flex-wrap:wrap;gap:8px}
#${ID} .nkp-chip{padding:6px 11px;border-radius:99px;border:1px solid rgba(201,162,39,.6);color:#d8b451;font-size:13px}
#${ID} .nkp-chip.is-locked{border-color:#241f12;color:#8f8872}
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

function fillFire(fire: HTMLElement, s: Streak) {
  fire.textContent = '';
  fire.append(el('div', undefined, streakText(s)));
}

function chip(a: Ach, earned: boolean): HTMLElement {
  const li = el('li', 'nkp-chip' + (earned ? '' : ' is-locked'));
  li.dir = 'auto';
  li.title = a.description;
  li.append(a.name, el('span', 'nkp-sr', ` — ${earned ? 'получено' : 'не получено'}. ${a.description}`));
  return li;
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
    const bar = el('div', 'nkp-bar'), fill = el('i');
    fill.style.width = `${pct}%`;
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Прогресс до следующего ранга');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(pct));
    bar.append(fill);
    const note = el('div', 'nkp-muted', p.next_rank ? `До «${p.next_rank.name}» осталось $${Math.ceil(p.next_rank.need)}` : 'Высший ранг');
    note.dir = 'auto';
    rankCard.append(pill, bar, note);
    body.append(rankCard);
  }

  body.append(el('h2', undefined, 'Огонёк'));
  const fire = el('div', 'nkp-card');
  fillFire(fire, p.streak);
  body.append(fire);

  const earned = p.achievements?.earned || [], locked = p.achievements?.locked || [];
  const h = el('h2', undefined, 'Достижения');
  if(earned.length + locked.length) h.append(el('small', undefined, `${earned.length} из ${earned.length + locked.length}`));
  body.append(h);
  if(earned.length + locked.length) {
    const chips = el('ul', 'nkp-chips');
    earned.forEach(a => chips.append(chip(a, true)));
    locked.forEach(a => chips.append(chip(a, false)));
    body.append(chips);
  } else {
    body.append(status('Скоро: достижения появятся здесь, когда клуб их запустит.'));
  }

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
