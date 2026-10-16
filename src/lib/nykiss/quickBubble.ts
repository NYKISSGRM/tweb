// src/lib/nykiss/quickBubble.ts
// NYKISS Gram — floating Quick Bubble for operators.
// Includes Heat Pulse: status ring on chat list avatars.
//
// Bridge between the messenger and wcrm: from the open chat the operator attaches
// the counterpart ("мамонт") to their CRM with correct attribution, and sees that
// counterpart's CRM status inline. Auth is a per-worker key (tweb is a full Telegram
// client, not a Mini App, so there's no initData to mint a JWT) — pasted once, kept
// in localStorage, sent as X-NYKISS-Key.
//
// Framework-free: mounts into <body>, never touches the SolidJS tree. Reads the open
// chat via the appImManager singleton.

import appImManager from '@lib/appImManager';
import getPeerActiveUsernames from '@appManagers/utils/peers/getPeerActiveUsernames';
import {planFolders, HEAT_FOLDER_TITLES, HEAT_FOLDER_EMOTICONS, HeatKey} from '@lib/nykiss/heatFolders';

const API = 'https://wcrm.206.71.148.212.nip.io/api/v1';
const KEY_LS = 'nykiss_messenger_key';

// ---- Heat Pulse ---------------------------------------------------------------

// Temperature lives in the CRM (shared across browsers, team lead sees everyone):
//   cold — default, nothing shown   warm — operator marks "ready to pay"
//   hot  — set by the server itself once TRICK reports a deposit (never manual)
type Heat = 'cold' | 'warm' | 'hot';
const heatMap = new Map<string, Heat>();        // user id (= tweb peerId) → heat
const heatByName = new Map<string, Heat>();     // username → heat, for мамонты the CRM knows only by @username
const peerUsername = new Map<string, string>(); // user id → username ('' = none); filled from tweb's own cache

function heatOf(peerId: number | string | null | undefined): Heat {
  if(peerId == null) return 'cold';
  const id = String(peerId);
  const byId = heatMap.get(id);
  if(byId) return byId;
  const name = peerUsername.get(id);
  return (name && heatByName.get(name)) || 'cold';
}

// Every chat the CRM has a temperature for, by id (usernames matched to ids where tweb knows them).
function allHeat(): Map<string, Heat> {
  const all = new Map(heatMap);
  if(heatByName.size) {
    peerUsername.forEach((name, id) => {
      const h = name && heatByName.get(name);
      if(h && !all.has(id)) all.set(id, h);
    });
  }
  return all;
}

// ---- rings: one observer, every avatar that carries a peer id ----
// tweb stamps `data-peer-id` on every `.avatar` (chat list, search, topbar, profile…), so one selector
// covers them all. The profile carousel has no id on its photos: its container is painted from the first one.

const AVATAR_SEL = '.avatar[data-peer-id]';
const PROFILE_SEL = '.profile-avatars-container';
const pendingRings = new Set<HTMLElement>();
let ringFrame = 0;
let ringFullScan = false;

function setHeatAttr(el: HTMLElement, peerId: string | undefined) {
  const heat = heatOf(peerId);
  const cur = el.dataset.heat;
  if(heat === 'cold') { if(cur) delete el.dataset.heat; } else if(cur !== heat) el.dataset.heat = heat;
}

function paintAvatar(av: HTMLElement) {
  // topics / saved messages carry a thread id and the peer of the group — not a person
  if(av.dataset.threadId || av.closest(PROFILE_SEL)) { delete av.dataset.heat; return; }
  setHeatAttr(av, av.dataset.peerId);
}

function paintProfile(box: HTMLElement) {
  const first = box.querySelector<HTMLElement>('.profile-avatars-avatar-first .avatar[data-peer-id]') ||
    box.querySelector<HTMLElement>(AVATAR_SEL);
  setHeatAttr(box, first?.dataset.peerId);
}

// Learn usernames of the ids on screen from tweb's cache (no network) — only needed while the CRM
// has мамонты it knows by @username alone.
let resolvingNames = false;
async function resolveNames(avatars: HTMLElement[]) {
  if(!heatByName.size || resolvingNames) return;
  const ids = [...new Set(avatars.map(a => a.dataset.peerId || ''))]
  .filter(id => /^\d+$/.test(id) && !peerUsername.has(id)).slice(0, 200);
  if(!ids.length) return;
  resolvingNames = true;
  try {
    const {appUsersManager} = appImManager.managers;
    let learned = false;
    for(const id of ids) {
      const user: any = await appUsersManager.getUser(+id);
      const name = String((user && ((getPeerActiveUsernames(user) || [])[0] || user.username)) || '').toLowerCase();
      peerUsername.set(id, name);
      if(name && heatByName.has(name)) learned = true;
    }
    if(learned) { applyAllRings(); reconcileHeatFolders(); }
  } catch(e) { /* user not cached yet — try on the next pass */ } finally { resolvingNames = false; }
}

function flushRings() {
  ringFrame = 0;
  const seen: HTMLElement[] = [];
  if(ringFullScan) {
    ringFullScan = false;
    document.querySelectorAll<HTMLElement>(AVATAR_SEL).forEach(av => { paintAvatar(av); seen.push(av); });
    document.querySelectorAll<HTMLElement>(PROFILE_SEL).forEach(paintProfile);
  } else {
    pendingRings.forEach(n => {
      if(!n.isConnected) return;
      if(n.matches(AVATAR_SEL)) { paintAvatar(n); seen.push(n); }
      n.querySelectorAll<HTMLElement>(AVATAR_SEL).forEach(av => { paintAvatar(av); seen.push(av); });
      const box = n.closest<HTMLElement>(PROFILE_SEL);
      if(box) paintProfile(box);
      n.querySelectorAll<HTMLElement>(PROFILE_SEL).forEach(paintProfile);
    });
  }
  pendingRings.clear();
  if(seen.length) resolveNames(seen);
}

function scheduleRings() {
  if(!ringFrame) ringFrame = requestAnimationFrame(flushRings);
}

function applyAllRings() {
  ringFullScan = true;
  scheduleRings();
}

let ringObserver: MutationObserver | null = null;
function watchAvatars() {
  if(ringObserver) return;
  ringObserver = new MutationObserver(records => {
    for(const r of records) {
      if(r.type === 'attributes') pendingRings.add(r.target as HTMLElement);
      else r.addedNodes.forEach(n => { if(n.nodeType === 1) pendingRings.add(n as HTMLElement); });
    }
    if(pendingRings.size) scheduleRings();
  });
  // tweb reuses avatar nodes and swaps the peer id on a live one, so the attribute is watched too
  ringObserver.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['data-peer-id']
  });
  applyAllRings();
}

function updateFabRing(telegramId?: number | null) {
  if(!fabEl) return;
  const heat = heatOf(telegramId ?? currentPeerId);
  if(heat === 'cold') delete fabEl.dataset.heat;
  else fabEl.dataset.heat = heat;
}

// ---- Heat folders: real Telegram folders «Тёплые» / «Горячие» -----------------
// The CRM owns them: content = exactly the chats with that temperature (see heatFolders.ts).
// Cold chats have no folder. Folders live on the Telegram account, so they follow the operator everywhere.

const FOLDER_CAP = 100; // Telegram: chats per folder
let folderDirty = false;
let folderRunning: Promise<void> | null = null;

async function runFolderPass() {
  const {filtersStorage: fs, appPeersManager, appUsersManager} = appImManager.managers;
  const want: Record<HeatKey, number[]> = {warm: [], hot: []};
  const unresolved: Record<HeatKey, number> = {warm: 0, hot: 0};

  for(const [id, heat] of allHeat()) {
    if(heat === 'cold') continue;
    const user: any = await appUsersManager.getUser(+id);
    // a chat can only join a folder when tweb holds its access hash
    if(user && (user.access_hash || user.pFlags?.self) && want[heat].length < FOLDER_CAP) want[heat].push(+id);
    else unresolved[heat]++;
  }

  const fresh: any[] = (await fs.getDialogFilters(true)).filter((f: any) => f._ === 'dialogFilter' && f.id > 1);
  const ops = planFolders(fresh.map(f => ({
    id: f.id,
    title: f.title?.text || '',
    includePeerIds: f.includePeerIds || [],
    pinnedPeerIds: f.pinnedPeerIds || [],
    excludePeerIds: f.excludePeerIds || []
  })), want, unresolved);

  for(const op of ops) {
    if(op.type === 'delete') {
      const f = fresh.find(x => x.id === op.id);
      if(f) await fs.updateDialogFilter(f, true);
      continue;
    }
    const inputPeers = await Promise.all(op.peerIds.map(id => appPeersManager.getInputPeerById(id)));
    // built from scratch: nothing of a previous version (pinned, excluded, flags) is carried over
    const filter: any = {
      _: 'dialogFilter', pFlags: {}, id: op.id ?? 0,
      title: {_: 'textWithEntities', text: HEAT_FOLDER_TITLES[op.key], entities: []},
      emoticon: HEAT_FOLDER_EMOTICONS[op.key],
      pinned_peers: [], pinnedPeerIds: [],
      exclude_peers: [], excludePeerIds: [],
      include_peers: inputPeers, includePeerIds: op.peerIds
    };
    if(op.id === null) await fs.createDialogFilter(filter);
    else await fs.updateDialogFilter(filter);
  }
}

// A request that arrives mid-pass is not dropped: it marks the state dirty and the pass runs once more.
// The Web Lock keeps two tabs from creating the same folder twice.
function reconcileHeatFolders(): Promise<void> {
  folderDirty = true;
  if(folderRunning) return folderRunning;
  const run = async() => {
    while(folderDirty) {
      folderDirty = false;
      try {
        if(navigator.locks) await navigator.locks.request('nykiss-heat-folders', runFolderPass);
        else await runFolderPass();
      } catch(e) { console.warn('[nykiss] heat folders:', e); }
    }
  };
  folderRunning = run().finally(() => { folderRunning = null; });
  return folderRunning;
}

// ---- CRM sync ----

async function fetchHeat() {
  const r = await apiFetch('/messenger/heat');
  heatMap.clear();
  heatByName.clear();
  for(const it of r.items || []) {
    const heat = it.heat as Heat;
    if(it.telegram_id) heatMap.set(String(it.telegram_id), heat);
    else if(it.username) heatByName.set(String(it.username).toLowerCase(), heat);
  }
  applyAllRings();
  updateFabRing();
  await reconcileHeatFolders();
}

// Never dropped: a call during a request asks for one more round after it, so the state always ends fresh.
let heatPromise: Promise<void> | null = null;
let heatAgain = false;
function refreshHeat(): Promise<void> {
  if(!getKey()) return Promise.resolve();
  if(heatPromise) { heatAgain = true; return heatPromise; }
  heatPromise = (async() => {
    do {
      heatAgain = false;
      try { await fetchHeat(); } catch(e) { /* offline / bad key — keep the last known state */ }
    } while(heatAgain);
  })().finally(() => { heatPromise = null; });
  return heatPromise;
}

// One-time: "warm" marks kept per-browser before the CRM held them. Cold is the default and hot comes
// from money, so only warm carries over.
const HEAT_MIGRATED_KEY = 'nykiss_heat_to_crm_migrated';
async function migrateLegacyHeat() {
  try {
    if(localStorage.getItem(HEAT_MIGRATED_KEY) || !getKey()) return;
    const legacy: string[] = [];
    for(let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      const m = /^nykiss_heat_(-?\d+)$/.exec(k);
      if(m && localStorage.getItem(k) === 'warm') legacy.push(m[1]);
    }
    for(const id of legacy) {
      try { await apiFetch('/messenger/heat', {method: 'POST', body: JSON.stringify({telegram_id: +id, warm: true})}); } catch(e) { /* not our мамонт */ }
    }
    localStorage.setItem(HEAT_MIGRATED_KEY, '1');
  } catch(e) {}
}

// ---- key storage -------------------------------------------------------------

function getKey(): string {
  try { return localStorage.getItem(KEY_LS) || ''; } catch(e) { return ''; }
}
function setKey(k: string | null) {
  try { k ? localStorage.setItem(KEY_LS, k) : localStorage.removeItem(KEY_LS); } catch(e) {}
}

// ---- API ---------------------------------------------------------------------

async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(API + path, {
    ...opts,
    headers: {'Content-Type': 'application/json', 'X-NYKISS-Key': getKey(), ...(opts.headers || {})}
  });
  if(res.status === 401) { setKey(''); throw new Error('bad-key'); }
  if(!res.ok) throw new Error('http-' + res.status);
  return res.status === 204 ? null : res.json();
}

type OpenMammoth = {telegram_id: number; username: string | null; nickname: string};

// The counterpart of the currently open chat, only when it's a user (not a group/channel).
async function getOpenMammoth(): Promise<OpenMammoth | null> {
  const peerId = appImManager.chat?.peerId as any;
  if(!peerId || !peerId.isUser || !peerId.isUser()) return null;
  const userId = peerId.toUserId();
  const user: any = await appImManager.managers.appUsersManager.getUser(userId);
  if(!user) return null;
  const usernames = getPeerActiveUsernames(user);
  const username = (usernames && usernames[0]) || user.username || null;
  const nickname = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
    || (username ? '@' + username : 'id' + userId);
  return {telegram_id: Number(userId), username, nickname};
}

// ---- styles ------------------------------------------------------------------

const STYLE_ID = 'nykiss-quick-bubble-style';

function injectStyle() {
  if(document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.nykiss-qb { position: fixed; right: 16px; bottom: 104px; z-index: 5;
  display: none; font-family: var(--font-family, inherit);
  -webkit-user-select: none; user-select: none; }
.nykiss-qb.is-visible { display: block; }

.nykiss-qb__fab { width: 48px; height: 48px; border-radius: 50%; border: none;
  cursor: pointer; color: #1a1206;
  background: linear-gradient(135deg, var(--primary-color, #C9A227), #B8891E);
  box-shadow: 0 6px 18px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.06) inset;
  font-weight: 800; font-size: 22px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  transition: transform .18s ease, box-shadow .2s ease; }
.nykiss-qb__fab:hover { transform: translateY(-2px) scale(1.04); }
.nykiss-qb__fab:active { transform: scale(.96); }
.nykiss-qb.is-open .nykiss-qb__fab { transform: rotate(45deg); }
.nykiss-qb__fab[data-heat="cold"] { box-shadow: 0 6px 18px rgba(0,0,0,.45), 0 0 0 3px #2A6B9A; }
.nykiss-qb__fab[data-heat="warm"] { box-shadow: 0 6px 18px rgba(0,0,0,.45), 0 0 0 3px #C9A227; }
.nykiss-qb__fab[data-heat="hot"]  { box-shadow: 0 6px 18px rgba(0,0,0,.45), 0 0 0 3px #E05A20; }

.nykiss-qb__heat { display:flex; gap:8px; align-items:center; padding:8px 6px 4px; }
.nykiss-qb__heat-label { font-size:11px; opacity:.45; text-transform:uppercase; letter-spacing:.06em; flex:1; }
.nykiss-qb__err { font-size:12px; color:#f0a9a0; padding:6px 4px 0; line-height:1.35; }
.nykiss-qb__heat-pill { padding:5px 11px; border-radius:20px; font-size:12.5px; font-weight:600; cursor:pointer;
  color:inherit; background:rgba(255,255,255,.07); border:1.5px solid rgba(255,255,255,.12); transition:all .15s; }
.nykiss-qb__heat-pill:hover { opacity:.85; }
.nykiss-qb__heat-pill:disabled { opacity:.5; cursor:default; }
.nykiss-qb__heat-pill[data-heat="cold"].is-active { background:rgba(42,107,154,.25); border-color:#2A6B9A; color:#5ba8d4; }
.nykiss-qb__heat-pill[data-heat="warm"].is-active { background:rgba(201,162,39,.25); border-color:#C9A227; color:#e9c860; }
.nykiss-qb__heat-auto { padding:5px 11px; border-radius:20px; font-size:12.5px; font-weight:700;
  background:rgba(224,90,32,.25); border:1.5px solid #E05A20; color:#FF6B30; }

/* status chip above the FAB — reflects CRM status of the open chat */
.nykiss-qb__chip { position: absolute; right: 0; bottom: 58px; white-space: nowrap;
  padding: 5px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;
  background: var(--surface-color, #1a1206); color: var(--primary-text-color, #f0ead8);
  box-shadow: 0 6px 18px rgba(0,0,0,.4), 0 0 0 1px rgba(201,162,39,.18);
  display: none; }
.nykiss-qb__chip.is-shown { display: block; }
.nykiss-qb__chip.is-mine { box-shadow: 0 6px 18px rgba(0,0,0,.4), 0 0 0 1px rgba(201,162,39,.5); }
.nykiss-qb__chip.is-foreign { box-shadow: 0 6px 18px rgba(0,0,0,.4), 0 0 0 1px rgba(201,80,80,.5); color: #f0c9c9; }

.nykiss-qb__menu { position: absolute; right: 0; bottom: 60px; width: 280px;
  max-height: 70vh; overflow-y: auto; padding: 10px; border-radius: 16px;
  background: var(--surface-color, #1a1206); color: var(--primary-text-color, #f0ead8);
  box-shadow: 0 12px 40px rgba(0,0,0,.55), 0 0 0 1px rgba(201,162,39,.18);
  opacity: 0; transform: translateY(8px) scale(.98); pointer-events: none;
  transition: opacity .16s ease, transform .16s ease; }
.nykiss-qb.is-open .nykiss-qb__menu { opacity: 1; transform: none; pointer-events: auto; }

.nykiss-qb__title { font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
  opacity: .55; padding: 4px 6px 8px; }
.nykiss-qb__status { padding: 8px 10px; border-radius: 10px; font-size: 13px; line-height: 1.4;
  background: rgba(201,162,39,.08); margin-bottom: 8px; }
.nykiss-qb__status b { font-weight: 700; }
.nykiss-qb__status .muted { opacity: .6; }

.nykiss-qb__btn { display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 11px 12px; border: none; border-radius: 10px; cursor: pointer;
  text-align: left; font-size: 14px; font-weight: 600; transition: filter .12s ease; }
.nykiss-qb__btn-primary { color: #1a1206; background: linear-gradient(135deg, #C9A227, #B8891E); }
.nykiss-qb__btn-primary:hover { filter: brightness(1.08); }
.nykiss-qb__btn-ghost { color: inherit; background: transparent; font-weight: 500; }
.nykiss-qb__btn-ghost:hover { background: rgba(201,162,39,.12); }
.nykiss-qb__btn:disabled { opacity: .45; cursor: default; }
.nykiss-qb__hint { font-size: 12px; opacity: .55; padding: 6px; line-height: 1.4; }

/* CRM Header Strip — shown under chat name in topbar */
  text-overflow: ellipsis; line-height: 1.4; padding-top: 3px; max-width: 280px;
  opacity: .8; transition: color .2s; }

`;
  document.head.appendChild(style);
}

// ---- DOM ---------------------------------------------------------------------

let inited = false;
let rootEl: HTMLDivElement;
let fabEl: HTMLButtonElement;
let menuEl: HTMLDivElement;
let chipEl: HTMLDivElement;

// Identity of the chat the menu/chip currently reflect, to avoid stale writes.
let currentPeerId: number | null = null;

function getActiveInput(): HTMLElement | null {
  const inputs = Array.from(
    document.querySelectorAll<HTMLElement>('.input-message-input[contenteditable="true"]')
  );
  return inputs.find((el) => el.offsetParent !== null) || null;
}

function closeMenu() { rootEl.classList.remove('is-open'); }
function openMenu() { rootEl.classList.add('is-open'); renderMenu(); }
function toggleMenu() { rootEl.classList.contains('is-open') ? closeMenu() : openMenu(); }

// --- connect flow ---
async function promptConnect() {
  const key = window.prompt('Вставь ключ NYKISS Gram (Настройки → NYKISS Gram — ключ в мини-аппе):');
  if(!key || !key.trim()) return;
  setKey(key.trim());
  try {
    const me = await apiFetch('/messenger/whoami');
    window.alert('Подключено: ' + (me?.display_name || 'воркер'));
  } catch(e) {
    setKey('');
    window.alert('Ключ не подошёл. Проверь и вставь заново.');
  }
  renderMenu();
  refreshBadge();
}

function setErr(errEl: HTMLElement, msg: string) {
  errEl.textContent = msg;
  errEl.style.display = msg ? '' : 'none';
}

function errText(e: any): string {
  if(e?.message === 'bad-key') return 'Ключ слетел — подключись заново.';
  if(e?.message === 'http-404') return 'Сначала добавь мамонта в CRM.';
  return 'Не получилось, попробуй ещё раз.';
}

// --- add мамонт ---
async function addMammoth(btn: HTMLButtonElement, errEl: HTMLElement) {
  const m = await getOpenMammoth();
  if(!m) { setErr(errEl, 'Открой личный чат с мамонтом.'); return; }
  btn.disabled = true;
  btn.textContent = 'Добавляю…';
  setErr(errEl, '');
  try {
    await apiFetch('/messenger/mammoths', {
      method: 'POST',
      body: JSON.stringify({nickname: m.nickname, telegram_username: m.username, telegram_id: m.telegram_id})
    });
    refreshBadge();
    refreshHeat();
    renderMenu(); // the temperature picker appears right away
  } catch(e: any) {
    btn.disabled = false;
    btn.textContent = '➕ Добавить мамонта';
    setErr(errEl, e?.message === 'bad-key' ? errText(e) : 'Не удалось добавить.');
  }
}

// Temperature of an attached мамонт: cold (default) / warm (manual); hot only shown — it comes from money.
function buildHeatRow(m: OpenMammoth, current: Heat, errEl: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.className = 'nykiss-qb__heat';
  const label = document.createElement('span');
  label.className = 'nykiss-qb__heat-label';
  label.textContent = 'Температура';
  row.append(label);

  if(current === 'hot') {
    const hot = document.createElement('span');
    hot.className = 'nykiss-qb__heat-auto';
    hot.textContent = '💰 Горячий · оплатил';
    hot.title = 'Ставится сам, когда приходит оплата';
    row.append(hot);
    return row;
  }

  const pills: Partial<Record<Heat, HTMLButtonElement>> = {};
  const paint = (h: Heat) => {
    current = h;
    (Object.keys(pills) as Heat[]).forEach(k => pills[k].classList.toggle('is-active', k === h));
  };
  const lock = (on: boolean) => (Object.values(pills) as HTMLButtonElement[]).forEach(b => { b.disabled = on; });
  const peerKey = String(m.telegram_id);

  ([['cold', '🧊 Холодный'], ['warm', '🔥 Тёплый']] as const).forEach(([key, text]) => {
    const b = document.createElement('button');
    b.className = 'nykiss-qb__heat-pill' + (current === key ? ' is-active' : '');
    b.dataset.heat = key;
    b.textContent = text;
    pills[key] = b;
    b.addEventListener('click', async e => {
      e.stopPropagation();
      if(current === key) return;
      const prev = current;
      setErr(errEl, '');
      lock(true);
      paint(key); // optimistic: the ring and the pill answer at once
      if(key === 'cold') heatMap.delete(peerKey); else heatMap.set(peerKey, key);
      applyAllRings();
      updateFabRing(m.telegram_id);
      try {
        const r = await apiFetch('/messenger/heat', {
          method: 'POST',
          body: JSON.stringify({telegram_id: m.telegram_id, username: m.username, warm: key === 'warm'})
        });
        if(r?.heat === 'hot') { heatMap.set(peerKey, 'hot'); renderMenu(); }
        refreshHeat(); // folders
      } catch(err: any) {
        paint(prev); // roll back
        if(prev === 'cold') heatMap.delete(peerKey); else heatMap.set(peerKey, prev);
        applyAllRings();
        updateFabRing(m.telegram_id);
        setErr(errEl, errText(err));
      } finally { lock(false); }
    });
    row.append(b);
  });
  return row;
}

// --- menu render ---
// Only the newest call may touch the menu: it awaits the chat and the CRM, and a stale one would
// append a second status block into the fresh menu.
let renderSeq = 0;
async function renderMenu() {
  const seq = ++renderSeq;
  const m = getKey() ? await getOpenMammoth() : null;
  if(seq !== renderSeq) return;

  menuEl.textContent = '';
  const title = document.createElement('div');
  title.className = 'nykiss-qb__title';
  title.textContent = 'NYKISS CRM';
  menuEl.append(title);

  if(!getKey()) {
    const hint = document.createElement('div');
    hint.className = 'nykiss-qb__hint';
    hint.textContent = 'Подключи CRM один раз — и добавляй мамонтов из чата на свой аккаунт.';
    const connect = document.createElement('button');
    connect.className = 'nykiss-qb__btn nykiss-qb__btn-primary';
    connect.textContent = '🔗 Подключить CRM';
    connect.addEventListener('click', (e) => { e.stopPropagation(); promptConnect(); });
    menuEl.append(hint, connect);
    return;
  }

  const err = document.createElement('div');
  err.className = 'nykiss-qb__err';
  err.style.display = 'none';

  if(!m) {
    const hint = document.createElement('div');
    hint.className = 'nykiss-qb__hint';
    hint.textContent = 'Открой личный чат с мамонтом, чтобы добавить его в CRM.';
    menuEl.append(hint);
  } else {
    const status = document.createElement('div');
    status.className = 'nykiss-qb__status';
    status.innerHTML = '<span class="muted">Проверяю…</span>';
    const slot = document.createElement('div');
    menuEl.append(status, slot, err);

    let b: any;
    try {
      b = await apiFetch(`/messenger/lookup?telegram_id=${m.telegram_id}&username=${encodeURIComponent(m.username || '')}`);
    } catch(e: any) {
      if(seq !== renderSeq) return;
      status.innerHTML = `<span class="muted">${e?.message === 'bad-key' ? 'Ключ слетел — подключись заново.' : 'CRM недоступна.'}</span>`;
      return;
    }
    if(seq !== renderSeq) return;

    if(b?.mine) {
      status.innerHTML = `<b>${escapeHtml(b.nickname || m.nickname)}</b> — твой${b.taken_by_other ? ' <span class="muted">(есть и у других)</span>' : ''}<br>` +
        `${escapeHtml(b.status_label || '')} · занёс <b>$${(b.total_deposited || 0)}</b>`;
      slot.append(buildHeatRow(m, (b.heat || 'cold') as Heat, err));
    } else if(b?.taken_by_other) {
      status.innerHTML = '<b class="muted">Чужой мамонт</b><br><span class="muted">Привязан у другого воркера</span>';
    } else {
      // not in the CRM: only «Добавить» — the temperature appears once he is attached
      status.innerHTML = `<span class="muted">Не в CRM.</span> <b>${escapeHtml(m.nickname)}</b>`;
      const add = document.createElement('button');
      add.className = 'nykiss-qb__btn nykiss-qb__btn-primary';
      add.textContent = '➕ Добавить мамонта';
      add.addEventListener('click', (e) => { e.stopPropagation(); addMammoth(add, err); });
      slot.append(add);
    }
  }

  // disconnect at the bottom
  const disc = document.createElement('button');
  disc.className = 'nykiss-qb__btn nykiss-qb__btn-ghost';
  disc.style.marginTop = '6px';
  disc.textContent = 'Отключить CRM';
  disc.addEventListener('click', (e) => { e.stopPropagation(); setKey(''); renderMenu(); refreshBadge(); });
  menuEl.append(disc);
}

function escapeHtml(s: string): string {
  return (s || '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'} as any)[c]);
}

// --- chip (always-visible status above FAB) ---
async function refreshBadge() {
  chipEl.className = 'nykiss-qb__chip';
  if(!getKey()) return;
  const m = await getOpenMammoth();
  if(!m) return;
  const forThis = currentPeerId;
  try {
    const b = await apiFetch(`/messenger/lookup?telegram_id=${m.telegram_id}&username=${encodeURIComponent(m.username || '')}`);
    if(currentPeerId !== forThis) return; // chat switched mid-request
    if(b?.mine) {
      chipEl.textContent = `✓ твой · $${b.total_deposited || 0}`;
      chipEl.className = 'nykiss-qb__chip is-shown is-mine';
    } else if(b?.taken_by_other) {
      chipEl.textContent = '⚠ чужой мамонт';
      chipEl.className = 'nykiss-qb__chip is-shown is-foreign';
    } else {
      chipEl.textContent = '+ не в CRM';
      chipEl.className = 'nykiss-qb__chip is-shown';
    }
  } catch(e) { /* keep hidden on error */ }
}

// --- visibility / peer-change poll ---
let syncTick = 0;
function sync() {
  syncTick++;
  const visible = !!getActiveInput();
  rootEl.classList.toggle('is-visible', visible);
  if(!visible) { closeMenu(); currentPeerId = null; chipEl.className = 'nykiss-qb__chip'; return; }

  const peerId = (appImManager.chat?.peerId as any) ?? null;
  if(peerId !== currentPeerId) {
    currentPeerId = peerId;
    chipEl.className = 'nykiss-qb__chip';
    if(rootEl.classList.contains('is-open')) renderMenu();
    refreshBadge();
    updateFabRing();
    if(getKey()) refreshHeat();
  }

  // safety net for avatars that were rendered before the observer attached
  if(syncTick % 25 === 0) applyAllRings();
}

export function initQuickBubble() {
  if(inited) return;
  inited = true;
  injectStyle();

  rootEl = document.createElement('div');
  rootEl.className = 'nykiss-qb';

  chipEl = document.createElement('div');
  chipEl.className = 'nykiss-qb__chip';

  menuEl = document.createElement('div');
  menuEl.className = 'nykiss-qb__menu';

  fabEl = document.createElement('button');
  fabEl.className = 'nykiss-qb__fab';
  fabEl.textContent = 'N';
  fabEl.title = 'NYKISS CRM';
  fabEl.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });

  rootEl.append(chipEl, menuEl, fabEl);
  document.body.append(rootEl);

  document.addEventListener('click', (e) => { if(!rootEl.contains(e.target as Node)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeMenu(); });

  sync();
  watchAvatars();
  window.setTimeout(async() => { await migrateLegacyHeat(); refreshHeat(); }, 4000);
  window.setInterval(refreshHeat, 20000);
  window.setInterval(sync, 600);
}
