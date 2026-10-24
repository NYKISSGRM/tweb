// NYKISS Gram — «свои узнают своих».
// Раз в минуту говорим серверу «я в сети» и тянем состав команды; на аватарке коллеги (список чатов, шапка
// чата, профиль) появляется золотая метка, над ней подсказка с ником/рангом/огоньком. Состав приходит по
// личному ключу воркера и не содержит денег. В Telegram ничего не пишется: это чисто клиентская метка.
//
// Опрос бережёт общий лимит сервера на IP (30 неверных ключей за 15 минут): 401 — ключ сбрасываем и молчим,
// пока воркер не подключит новый; сеть/5xx/429 — пауза растёт вдвое; вкладка скрыта — не опрашиваем.

import rootScope from '@lib/rootScope';
import {toast} from '@components/toast';
import {API, buildId, getKey, markKeyRejected, noteHello} from '@lib/nykiss/quickBubble';
import {TeamMember, buildIndex, memberTitle, pollDelay, titleFire, titleRank} from '@lib/nykiss/teamModel';

const NO_KEY_MS = 5_000;    // ключа нет: раз в 5 с читаем localStorage (копейки), ждём, пока его подключат
const WARN_LS = 'nykiss_tid_warned';
const AVATAR_SEL = '.avatar[data-peer-id]';
const TITLE_SEL = '.peer-title[data-peer-id]';
const STYLE_ID = 'nykiss-team-style';

let index = new Map<string, TeamMember>();
let started = false;
let pending = new Set<HTMLElement>();
let frame = 0;
let fullScan = true;

type Reply = {status: 'ok' | 'auth' | 'retry', data?: any, wait?: number};

/** Gram открыт не под тем Telegram-аккаунтом, что привязан в CRM: кэш профиля сбрасывается по этому событию. */
export const IDENTITY_EVENT = 'nykiss:identity';
let mismatch = false;

let warnedMem = 0;      // запасной вариант, если localStorage недоступен
let blockedUntil = 0;   // 429 от сервера: до этого момента не шлём вообще ничего (лимит общий на IP)

const FETCH_TIMEOUT_MS = 12000;

// fetch, который не может зависнуть: мёртвый сервер или застрявшее соединение становится ошибкой сети
async function fetchTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {...init, signal: ctl.signal});
  } finally {
    window.clearTimeout(timer);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Reply> {
  const key = getKey();
  if(!key) return {status: 'auth'};   // ключ не введён: молча ничего не делаем, окно подключения не открываем
  if(Date.now() < blockedUntil) return {status: 'retry', wait: blockedUntil - Date.now()};
  let res: Response;
  try {
    res = await fetchTimeout(API + path, {
      ...init,
      headers: {'X-NYKISS-Key': key, 'X-NYKISS-Build': buildId(), ...(init.body ? {'Content-Type': 'application/json'} : {})}
    });
  } catch(e) {
    return {status: 'retry'};
  }
  if(res.status === 401) {
    markKeyRejected(key);   // ключ не стираем, а помечаем отклонённым (см. quickBubble); свежий ключ, пришедший пока шёл запрос, не трогаем
    return {status: 'auth'};
  }
  if(res.status === 429) {
    const wait = (Number(res.headers.get('Retry-After')) || 900) * 1000;
    blockedUntil = Date.now() + wait;
    return {status: 'retry', wait};
  }
  if(!res.ok) return {status: 'retry'};
  try {
    return {status: 'ok', data: await res.json()};
  } catch(e) {
    return {status: 'retry'};
  }
}

export async function teamApi(path: string, init: RequestInit = {}): Promise<any | null> {
  const r = await request(path, init);
  return r.status === 'ok' ? r.data : null;
}

function setMismatch(v: boolean) {
  if(mismatch === v) return;
  mismatch = v;
  window.dispatchEvent(new CustomEvent(IDENTITY_EVENT, {detail: v}));
}

// Тост один раз на Telegram-аккаунт: воркер сидит в Gram не под тем аккаунтом, что в CRM, метка на нём не появится.
function checkIdentity(id: number, data: any) {
  if(!id || !data) return;
  setMismatch(data.telegram_id_matches === false);
  try {
    if(data.telegram_id_matches !== false) { localStorage.removeItem(WARN_LS); return; }
    if(localStorage.getItem(WARN_LS) === String(id)) return;
    localStorage.setItem(WARN_LS, String(id));
  } catch(e) {
    if(warnedMem === id) return;
    warnedMem = id;
  }
  toast('NYKISS: ты в Gram под другим Telegram-аккаунтом, чем в CRM. Метка на тебе не появится: зайди с основного.', undefined, 9000);
}

let lastItemsSig = '';
function apply(data: any) {
  // the same roster again: nothing to repaint
  const sig = JSON.stringify(data.items);
  if(sig === lastItemsSig) return;
  lastItemsSig = sig;
  index = buildIndex(data.items);
  fullScan = true;
  schedule();
}

async function cycle(): Promise<Reply> {
  const id = Number(rootScope.myId);
  const hi = await request('/messenger/hello', {method: 'POST', body: JSON.stringify(id ? {telegram_id: id} : {})});
  if(hi.status !== 'ok') return hi;
  noteHello();
  checkIdentity(id, hi.data);
  const tm = await request('/messenger/team');
  if(tm.status === 'ok') apply(tm.data);
  return tm;
}

// ---- цикл опроса: один таймер, пауза по результату ----------------------------------------------------

let timer = 0;
let nextAt = 0;
let fails = 0;
let running = false;

function plan(ms: number) {
  window.clearTimeout(timer);
  nextAt = Date.now() + ms;
  timer = window.setTimeout(tick, ms);
}

async function tick() {
  timer = 0;
  if(document.hidden) {   // скрытая вкладка не опрашивает; вернёт visibilitychange — но не раньше паузы после ошибок/429
    nextAt = Math.max(blockedUntil, fails ? Date.now() + pollDelay(fails) : 0);
    return;
  }
  if(running) return;
  if(!getKey()) { fails = 0; plan(NO_KEY_MS); return; }
  running = true;
  let r: Reply;
  try {
    r = await cycle();
  } finally {
    running = false;
  }
  if(r.status === 'retry') plan(pollDelay(++fails, r.wait));
  else { fails = 0; plan(r.status === 'ok' ? pollDelay(0) : NO_KEY_MS); }
}

// ---- метки на аватарках: один observer на весь документ, пачками в rAF --------------------------------

function mark(el: HTMLElement) {
  const m = index.get(el.dataset.peerId || '');
  if(!m) {
    if(el.dataset.nkTeam) {
      delete el.dataset.nkTeam;
      el.removeAttribute('data-nk-title');
      el.removeAttribute('title');   // аватарки переиспользуются: подсказка прошлого коллеги не должна остаться
    }
    return;
  }
  const state = m.online ? 'online' : 'offline';
  if(el.dataset.nkTeam !== state) el.dataset.nkTeam = state;
  const title = memberTitle(m);
  if(el.getAttribute('data-nk-title') !== title) { el.setAttribute('data-nk-title', title); el.title = title; }
}

// имя коллеги: эмодзи ранга ПЕРЕД именем, огонёк ПОСЛЕ него (рисует CSS из атрибутов: DOM и поведение имени не трогаем)
function setAttr(el: HTMLElement, key: 'nkRank' | 'nkFire', value: string) {
  if(value) { if(el.dataset[key] !== value) el.dataset[key] = value; } else if(el.dataset[key]) delete el.dataset[key];
}

function markTitle(el: HTMLElement) {
  const m = index.get(el.dataset.peerId || '');
  setAttr(el, 'nkRank', m ? titleRank(m) : '');
  setAttr(el, 'nkFire', m ? titleFire(m) : '');
}

function flush() {
  frame = 0;
  if(fullScan) {
    fullScan = false;
    pending.clear();
    document.querySelectorAll<HTMLElement>(AVATAR_SEL).forEach(mark);
    document.querySelectorAll<HTMLElement>(TITLE_SEL).forEach(markTitle);
    return;
  }
  const batch = pending;
  pending = new Set();
  batch.forEach(n => {
    if(n.matches?.(AVATAR_SEL)) mark(n);
    n.querySelectorAll?.<HTMLElement>(AVATAR_SEL).forEach(mark);
    if(n.matches?.(TITLE_SEL)) markTitle(n);
    n.querySelectorAll?.<HTMLElement>(TITLE_SEL).forEach(markTitle);
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
:where(.avatar[data-nk-team]) { position: relative; }
.avatar[data-nk-team] { --nk-badge: clamp(11px, calc(var(--size, 54px) * .36), 20px); }
.avatar[data-nk-team]::before {
  content: ''; position: absolute; z-index: 4; pointer-events: none;
  inline-size: var(--nk-badge); block-size: var(--nk-badge);
  inset-block-start: calc(var(--size, 54px) * .146 - var(--nk-badge) / 2);
  inset-inline-start: calc(var(--size, 54px) * .146 - var(--nk-badge) / 2);
  border-radius: 50%; box-sizing: border-box; border: 1.5px solid #C9A227;
  background: #0b0c0a url("data:image/svg+xml,${BADGE_SVG}") center / 74% no-repeat;
}
.avatar[data-nk-team="online"]::before { box-shadow: 0 0 0 2px rgba(50, 162, 113, .95); }
.avatar:is(.avatar-16, .avatar-18, .avatar-20, .avatar-22)[data-nk-team]::before { display: none; }

.bubbles-group-avatar[data-nk-team] { overflow: visible; }
.peer-title[data-nk-rank]::before { content: attr(data-nk-rank) ' '; font-style: normal; }
.peer-title[data-nk-fire]::after { content: attr(data-nk-fire); margin-inline-start: .5em; font-style: normal; white-space: nowrap; }
`;
  document.head.appendChild(st);
}

export function initTeam() {
  if(started) return;
  started = true;
  injectStyle();
  watch();
  plan(0);
  // вернулись на вкладку: опрашиваем не раньше, чем положено (пауза после ошибок и 429 соблюдается)
  document.addEventListener('visibilitychange', () => {
    // hello сразу при возврате на вкладку; пауза после 429/ошибок по-прежнему соблюдается (blockedUntil)
    if(!document.hidden) plan(Math.max(0, blockedUntil - Date.now()));
  });
}
