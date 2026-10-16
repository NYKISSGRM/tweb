// NYKISS Gram — «свои узнают своих».
// Раз в минуту говорим серверу «я в сети» и тянем состав команды; на аватарке коллеги (список чатов, шапка
// чата, профиль) появляется золотая метка, над ней подсказка с ником/рангом/огоньком. Состав приходит по
// личному ключу воркера и не содержит денег. В Telegram ничего не пишется: это чисто клиентская метка.

import rootScope from '@lib/rootScope';
import {API, getKey, fetchTimeout} from '@lib/nykiss/quickBubble';
import {TeamMember, buildIndex, memberTitle} from '@lib/nykiss/teamModel';

const POLL_MS = 60_000;
const AVATAR_SEL = '.avatar[data-peer-id]';
const STYLE_ID = 'nykiss-team-style';

let index = new Map<string, TeamMember>();
let me: TeamMember | null = null;
let members: TeamMember[] = [];
let started = false;
let pending = new Set<HTMLElement>();
let frame = 0;
let fullScan = true;

export function getTeamMembers(): TeamMember[] { return members; }
export function getMe(): TeamMember | null { return me; }

export async function teamApi(path: string, init: RequestInit = {}): Promise<any | null> {
  const key = getKey();
  if(!key) return null;   // ключ не введён: молча ничего не делаем, окно подключения не открываем
  try {
    const res = await fetchTimeout(API + path, {
      ...init,
      headers: {'X-NYKISS-Key': key, ...(init.body ? {'Content-Type': 'application/json'} : {})}
    });
    return res.ok ? await res.json() : null;
  } catch(e) {
    return null;
  }
}

async function hello() {
  const id = Number(rootScope.myId);
  await teamApi('/messenger/hello', {method: 'POST', body: JSON.stringify(id ? {telegram_id: id} : {})});
}

async function refresh() {
  const data = await teamApi('/messenger/team');
  if(!data) return;
  index = buildIndex(data.items);
  members = (Array.isArray(data.items) ? data.items : []) as TeamMember[];
  me = members.find(m => m && m.me) || null;
  fullScan = true;
  schedule();
}

// ---- метки на аватарках: один observer на весь документ, пачками в rAF --------------------------------

function mark(el: HTMLElement) {
  const m = index.get(el.dataset.peerId || '');
  if(!m) {
    if(el.dataset.nkTeam) { delete el.dataset.nkTeam; el.removeAttribute('data-nk-title'); }
    return;
  }
  const state = m.online ? 'online' : 'offline';
  if(el.dataset.nkTeam !== state) el.dataset.nkTeam = state;
  const title = memberTitle(m);
  if(el.getAttribute('data-nk-title') !== title) { el.setAttribute('data-nk-title', title); el.title = title; }
}

function flush() {
  frame = 0;
  if(fullScan) {
    fullScan = false;
    pending.clear();
    document.querySelectorAll<HTMLElement>(AVATAR_SEL).forEach(mark);
    return;
  }
  const batch = pending;
  pending = new Set();
  batch.forEach(n => {
    if(n.matches?.(AVATAR_SEL)) mark(n);
    n.querySelectorAll?.<HTMLElement>(AVATAR_SEL).forEach(mark);
  });
}

function schedule() { if(!frame) frame = requestAnimationFrame(flush); }

function watch() {
  new MutationObserver(records => {
    for(const r of records) {
      if(r.type === 'attributes') pending.add(r.target as HTMLElement);
      else r.addedNodes.forEach(n => { if(n.nodeType === 1) pending.add(n as HTMLElement); });
    }
    if(pending.size > 300) { pending.clear(); fullScan = true; }
    schedule();
  }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-peer-id']});
  schedule();
}

const BADGE_SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><path d="M40 124V36L120 124V36" fill="none" ' +
  'stroke="#C9A227" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/></svg>'
);

function injectStyle() {
  if(document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
.avatar[data-nk-team] { position: relative; }
.avatar[data-nk-team]::after {
  content: ''; position: absolute; right: -1px; bottom: -1px; z-index: 4; pointer-events: none;
  width: 36%; height: 36%; min-width: 11px; min-height: 11px; max-width: 20px; max-height: 20px;
  border-radius: 50%; box-sizing: border-box; border: 1.5px solid #C9A227;
  background: #0b0c0a url("data:image/svg+xml,${BADGE_SVG}") center / 74% no-repeat;
}
.avatar[data-nk-team="online"]::after { box-shadow: 0 0 0 2px rgba(50, 162, 113, .95); }
`;
  document.head.appendChild(st);
}

// ---- пункт «Профиль NYKISS» в левом меню: рядом с «NYKISS», без правок исходников сайдбара ----------

function injectMenuItem(menu: HTMLElement) {
  if(menu.querySelector('[data-nk-profile-item]')) return;
  const items = Array.from(menu.querySelectorAll<HTMLElement>('.btn-menu-item'));
  const base = items.find(i => (i.textContent || '').trim() === 'NYKISS');
  if(!base) return;
  const item = base.cloneNode(true) as HTMLElement;
  item.setAttribute('data-nk-profile-item', '1');
  const label = item.querySelector<HTMLElement>('.btn-menu-item-text') || item;
  label.textContent = 'Профиль NYKISS';
  item.addEventListener('click', e => {
    e.stopPropagation();
    import('@lib/nykiss/profile').then(({openMyProfile}) => openMyProfile());
  }, true);
  base.after(item);
}

function watchMenu() {
  new MutationObserver(() => {
    document.querySelectorAll<HTMLElement>('.btn-menu').forEach(injectMenuItem);
  }).observe(document.body, {childList: true, subtree: true});
}

export function initTeam() {
  if(started) return;
  started = true;
  injectStyle();
  watch();
  watchMenu();
  const tick = async() => { await hello(); await refresh(); };
  tick();
  window.setInterval(() => { if(!document.hidden) tick(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) tick(); });
}
