// NYKISS Gram — «Профиль NYKISS»: мой ранг, огонёк, достижения, мои цифры и состав команды.
// Данные: GET /messenger/profile (по личному ключу). Ванильный оверлей, как nykissWeb.ts; весь текст
// ставится через textContent — данные с сервера не интерпретируются как HTML.

import {getTeamMembers, teamApi} from '@lib/nykiss/team';

const ID = 'nykiss-profile-overlay';
const STYLE_ID = 'nykiss-profile-style';

type Profile = {
  name: string,
  rank: {level: number, name: string, color: string} | null,
  rank_progress_pct: number,
  next_rank: {level: number, name: string, need: number} | null,
  streak: {state: string, current: number, best: number, tier_name?: string | null, can_restore?: boolean, appear_day?: number, hours_left_today?: number},
  achievements: {earned: {name: string, description: string}[], locked: {name: string, description: string}[]},
  stats: {profits_count: number, mammoths_count: number, total_earned: number}
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text != null) e.textContent = text;
  return e;
}

function injectStyle() {
  if(document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
#${ID}{position:fixed;inset:0;z-index:100000;background:rgba(7,8,7,.94);display:flex;justify-content:center;overflow-y:auto;
  font-family:Manrope,system-ui,sans-serif;color:#F3EEDF}
#${ID} .nkp{width:min(560px,100%);padding:max(20px,env(safe-area-inset-top)) 18px 40px;box-sizing:border-box}
#${ID} h1,#${ID} h2{font-family:Fraunces,Georgia,serif;font-weight:600;margin:0}
#${ID} h1{font-size:26px;letter-spacing:.01em}
#${ID} h2{font-size:15px;color:#C9A227;letter-spacing:.14em;text-transform:uppercase;margin:26px 0 10px}
#${ID} .nkp-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
#${ID} .nkp-x{width:38px;height:38px;border-radius:50%;border:1px solid rgba(201,162,39,.5);background:#15140d;color:#C9A227;font-size:20px;cursor:pointer}
#${ID} .nkp-card{background:#15140d;border:1px solid #241f12;border-radius:16px;padding:14px 16px}
#${ID} .nkp-pill{display:inline-block;padding:3px 10px;border-radius:99px;border:1px solid currentColor;font-size:12px;font-weight:700;margin-top:6px}
#${ID} .nkp-bar{height:6px;border-radius:99px;background:#241f12;margin-top:12px;overflow:hidden}
#${ID} .nkp-bar>i{display:block;height:100%;background:linear-gradient(90deg,#8a6b1d,#d8b451)}
#${ID} .nkp-muted{color:#9a927d;font-size:13px;margin-top:6px}
#${ID} .nkp-chips{display:flex;flex-wrap:wrap;gap:8px}
#${ID} .nkp-chip{padding:6px 11px;border-radius:99px;border:1px solid rgba(201,162,39,.6);color:#d8b451;font-size:13px}
#${ID} .nkp-chip.is-locked{border-color:#241f12;color:#6e6757}
#${ID} .nkp-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
#${ID} .nkp-stat b{display:block;font-family:'JetBrains Mono',monospace;font-size:20px;color:#f6e8ba}
#${ID} .nkp-stat span{font-size:12px;color:#9a927d}
#${ID} .nkp-mate{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #1c180d}
#${ID} .nkp-dot{width:9px;height:9px;border-radius:50%;background:#3a3526;flex:none}
#${ID} .nkp-dot.on{background:#32a271}
#${ID} .nkp-mate small{color:#9a927d;margin-left:auto;font-size:12px}
`;
  document.head.appendChild(st);
}

function streakText(s: Profile['streak']): string {
  if(s.state === 'lost') return s.can_restore ? 'Огонёк погас. Вернуть можно в мини-аппе: NYKISS → Профиль (окно 24 часа).' : 'Огонёк погас.';
  if(!s.current || s.state === 'none') return `Огонёк загорится после ${s.appear_day ?? 3} дней подряд с профитом.`;
  return `Серия ${s.current} дн.${s.tier_name ? ' · ' + s.tier_name : ''} · рекорд ${s.best}.`;
}

export function closeMyProfile() { document.getElementById(ID)?.remove(); document.removeEventListener('keydown', onKey, true); }
function onKey(e: KeyboardEvent) { if(e.key === 'Escape') { e.stopPropagation(); closeMyProfile(); } }

export async function openMyProfile() {
  if(document.getElementById(ID)) return;
  injectStyle();
  const root = el('div'); root.id = ID;
  const box = el('div', 'nkp');
  root.append(box);
  root.addEventListener('click', e => { if(e.target === root) closeMyProfile(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(root);

  const top = el('div', 'nkp-top');
  const title = el('h1', undefined, 'Профиль NYKISS');
  const x = el('button', 'nkp-x', '×'); x.setAttribute('aria-label', 'Закрыть'); x.onclick = closeMyProfile;
  top.append(title, x); box.append(top);
  const body = el('div'); box.append(body);
  body.append(el('p', 'nkp-muted', 'Загружаю…'));

  const p: Profile | null = await teamApi('/messenger/profile');
  body.textContent = '';
  if(!p) {
    body.append(el('p', 'nkp-muted', 'Не получилось загрузить. Проверь, что ключ подключён (меню N), и открой снова.'));
    return;
  }

  title.textContent = p.name;
  const rankCard = el('div', 'nkp-card');
  if(p.rank) {
    const pill = el('span', 'nkp-pill', p.rank.name); pill.style.color = /^#[0-9a-f]{3,8}$/i.test(p.rank.color) ? p.rank.color : '#C9A227';
    rankCard.append(pill);
  }
  const bar = el('div', 'nkp-bar'), fill = el('i'); fill.style.width = `${Math.max(0, Math.min(100, p.rank_progress_pct))}%`; bar.append(fill);
  rankCard.append(bar, el('div', 'nkp-muted', p.next_rank ? `До «${p.next_rank.name}» осталось $${Math.ceil(p.next_rank.need)}` : 'Высший ранг'));
  body.append(rankCard);

  body.append(el('h2', undefined, 'Огонёк'));
  const fire = el('div', 'nkp-card'); fire.append(el('div', undefined, streakText(p.streak))); body.append(fire);

  body.append(el('h2', undefined, 'Достижения'));
  const chips = el('div', 'nkp-chips');
  p.achievements.earned.forEach(a => { const c = el('span', 'nkp-chip', a.name); c.title = a.description; chips.append(c); });
  p.achievements.locked.forEach(a => { const c = el('span', 'nkp-chip is-locked', a.name); c.title = a.description; chips.append(c); });
  if(!chips.childElementCount) chips.append(el('div', 'nkp-muted', 'Достижения скоро появятся.'));
  body.append(chips);

  body.append(el('h2', undefined, 'Мои цифры'));
  const stats = el('div', 'nkp-card nkp-row');
  ([['Профитов', String(p.stats.profits_count)], ['Мамонтов', String(p.stats.mammoths_count)], ['Заработано', '$' + Math.round(p.stats.total_earned)]] as const)
  .forEach(([k, v]) => { const s = el('div', 'nkp-stat'); s.append(el('b', undefined, v), el('span', undefined, k)); stats.append(s); });
  body.append(stats);

  const mates = getTeamMembers().filter(m => !m.me);
  if(mates.length) {
    body.append(el('h2', undefined, 'Команда'));
    const list = el('div', 'nkp-card');
    mates.sort((a, b) => Number(b.online) - Number(a.online) || (b.rank?.level ?? 0) - (a.rank?.level ?? 0)).forEach(m => {
      const row = el('div', 'nkp-mate');
      const dot = el('i', 'nkp-dot' + (m.online ? ' on' : ''));
      row.append(dot, el('span', undefined, m.name), el('small', undefined, [m.rank?.name, m.fire ? `серия ${m.fire.len} дн.` : ''].filter(Boolean).join(' · ')));
      list.append(row);
    });
    body.append(list);
  }
}
