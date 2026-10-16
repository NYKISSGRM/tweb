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

const API = 'https://wcrm.206.71.148.212.nip.io/api/v1';
const KEY_LS = 'nykiss_messenger_key';

// ---- Heat Pulse ---------------------------------------------------------------

// Temperature lives in the CRM (shared across browsers, team lead sees everyone):
//   cold — default, nothing shown   warm — operator marks "ready to pay"
//   hot  — set by the server itself once TRICK reports a deposit (never manual)
type Heat = 'cold' | 'warm' | 'hot';
const heatMap = new Map<string, Heat>(); // telegram_id (= tweb user peerId) → heat

function heatOf(peerId: number | string | null | undefined): Heat {
  return (peerId != null && heatMap.get(String(peerId))) || 'cold';
}

function applyAllRings() {
  document.querySelectorAll<HTMLElement>('[data-peer-id]').forEach(el => {
    const peerId = el.dataset.peerId;
    const avatarEl = el.querySelector<HTMLElement>('.dialog-avatar');
    if(!avatarEl || !peerId) return;
    const heat = heatOf(peerId);
    if(heat === 'cold') delete avatarEl.dataset.heat;
    else avatarEl.dataset.heat = heat;
  });
}

function updateFabRing(telegramId?: number | null) {
  if(!fabEl) return;
  const heat = heatOf(telegramId ?? currentPeerId);
  if(heat === 'cold') delete fabEl.dataset.heat;
  else fabEl.dataset.heat = heat;
}

let ringObserver: MutationObserver | null = null;
function watchDialogList() {
  if(ringObserver) return;
  const target = document.getElementById('chatlist-container');
  if(!target) return;
  ringObserver = new MutationObserver(() => applyAllRings());
  ringObserver.observe(target, {childList: true, subtree: true});
  applyAllRings();
}

// ---- Heat folders: real Telegram folders «Тёплые» / «Горячие» -----------------
// Mirrors the CRM temperature into folders (created on first use). Cold chats have no folder.
// Folders live on the Telegram account, so they follow the operator to every device.

const HEAT_FOLDERS = {
  warm: {title: 'Тёплые', emoticon: '🔥'},
  hot: {title: 'Горячие', emoticon: '💰'}
} as const;
const FOLDER_CAP = 100; // Telegram: max chats per folder
const LEGACY_FOLDER_TITLE = 'Холодные'; // the one we created earlier; cold has no folder now

let folderQueue: Promise<void> = Promise.resolve();

function findFolder(filters: any[], title: string) {
  return filters.find(f => f._ === 'dialogFilter' && f.title?.text === title);
}

// Serialized: concurrent passes must not both create the same folder.
function reconcileHeatFolders() {
  folderQueue = folderQueue.then(async() => {
    const {filtersStorage, appPeersManager, appUsersManager} = appImManager.managers;
    let filters: any[] = await filtersStorage.getDialogFilters();

    const legacy = findFolder(filters, LEGACY_FOLDER_TITLE);
    if(legacy && legacy.emoticon === '🧊') await filtersStorage.updateDialogFilter(legacy, true);

    for(const key of ['warm', 'hot'] as const) {
      const def = HEAT_FOLDERS[key];
      const filter: any = findFolder(filters, def.title);
      const current: number[] = filter?.includePeerIds || [];

      // keep what the user put there by hand; drop CRM chats whose temperature moved on
      const kept = current.filter(id => !heatMap.has(String(id)) || heatMap.get(String(id)) === key);
      const want = [...heatMap].filter(([, h]) => h === key).map(([id]) => +id);
      const next = [...kept];
      for(const id of want) {
        if(next.length >= FOLDER_CAP) break;
        if(next.includes(id)) continue;
        const user: any = await appUsersManager.getUser(id);
        if(!user || !user.access_hash) continue; // no chat/contact access yet — can't be put in a folder
        next.push(id);
      }

      const unchanged = next.length === current.length && next.every(id => current.includes(id));
      if(unchanged || (!filter && !next.length)) continue;

      const inputPeers = await Promise.all(next.map(id => appPeersManager.getInputPeerById(id)));
      if(!filter) {
        await filtersStorage.createDialogFilter({
          _: 'dialogFilter', pFlags: {}, id: 0, emoticon: def.emoticon,
          title: {_: 'textWithEntities', text: def.title, entities: []},
          pinned_peers: [], include_peers: inputPeers, exclude_peers: [],
          pinnedPeerIds: [], includePeerIds: next, excludePeerIds: []
        } as any);
      } else {
        await filtersStorage.updateDialogFilter({...filter, includePeerIds: next, include_peers: inputPeers});
      }
      filters = await filtersStorage.getDialogFilters();
    }
  }).catch(e => console.warn('[nykiss] heat folders:', e));
  return folderQueue;
}

let heatInFlight = false;
async function refreshHeat() {
  if(!getKey() || heatInFlight) return;
  heatInFlight = true;
  try {
    const r = await apiFetch('/messenger/heat');
    heatMap.clear();
    for(const it of r.items || []) heatMap.set(String(it.telegram_id), it.heat);
    applyAllRings();
    updateFabRing();
    await reconcileHeatFolders();
  } catch(e) { /* offline / bad key — keep last known state */ } finally { heatInFlight = false; }
}

// One-time: statuses kept per-browser before the CRM held them. Only "warm" carries over:
// cold is the default and hot now comes from money.
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

async function setWarm(m: {telegram_id: number; username: string | null}, warm: boolean) {
  await apiFetch('/messenger/heat', {
    method: 'POST',
    body: JSON.stringify({telegram_id: m.telegram_id, username: m.username, warm})
  });
  await refreshHeat();
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

// --- add мамонт ---
async function addMammoth(btn: HTMLButtonElement) {
  const m = await getOpenMammoth();
  if(!m) { window.alert('Открой личный чат с мамонтом.'); return; }
  btn.disabled = true;
  btn.textContent = 'Добавляю…';
  try {
    const r = await apiFetch('/messenger/mammoths', {
      method: 'POST',
      body: JSON.stringify({nickname: m.nickname, telegram_username: m.username, telegram_id: m.telegram_id})
    });
    btn.textContent = r?.already ? '✓ Уже у тебя' : '✓ Добавлен';
    refreshBadge();
    setTimeout(() => { if(rootEl.classList.contains('is-open')) renderMenu(); }, 1200);
  } catch(e: any) {
    if(e?.message === 'bad-key') { window.alert('Ключ слетел — подключись заново.'); renderMenu(); }
    else { btn.disabled = false; btn.textContent = '➕ Добавить мамонта'; window.alert('Не удалось добавить.'); }
  }
}

// --- menu render ---
async function renderMenu() {
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

  const m = await getOpenMammoth();
  if(!m) {
    const hint = document.createElement('div');
    hint.className = 'nykiss-qb__hint';
    hint.textContent = 'Открой личный чат с мамонтом, чтобы добавить его в CRM.';
    menuEl.append(hint);
  } else {
    // status block
    const status = document.createElement('div');
    status.className = 'nykiss-qb__status';
    status.innerHTML = '<span class="muted">Проверяю…</span>';
    menuEl.append(status);

    // Temperature: cold is default, warm is manual, hot is automatic (paid).
    const heatRow = document.createElement('div');
    heatRow.className = 'nykiss-qb__heat';
    const heatLabel = document.createElement('span');
    heatLabel.style.cssText = 'font-size:11px;opacity:.45;text-transform:uppercase;letter-spacing:.06em;flex:1;';
    heatLabel.textContent = 'Температура';
    heatRow.append(heatLabel);
    const current = heatOf(m.telegram_id);
    if(current === 'hot') {
      const hot = document.createElement('span');
      hot.className = 'nykiss-qb__heat-auto';
      hot.textContent = '💰 Горячий · оплатил';
      hot.title = 'Ставится сам, когда приходит оплата';
      heatRow.append(hot);
    } else {
      ([['cold', '🧊 Холодный'], ['warm', '🔥 Тёплый']] as const).forEach(([key, label]) => {
        const b = document.createElement('button');
        b.className = 'nykiss-qb__heat-pill' + (current === key ? ' is-active' : '');
        b.dataset.heat = key;
        b.textContent = label;
        b.addEventListener('click', async e => {
          e.stopPropagation();
          if(current === key) return;
          b.disabled = true;
          try { await setWarm(m, key === 'warm'); } catch(err) { /* bad key / not attached */ }
          renderMenu();
        });
        heatRow.append(b);
      });
    }
    menuEl.append(heatRow);

    const add = document.createElement('button');
    add.className = 'nykiss-qb__btn nykiss-qb__btn-primary';
    add.textContent = '➕ Добавить мамонта';
    add.addEventListener('click', (e) => { e.stopPropagation(); addMammoth(add); });
    menuEl.append(add);

    try {
      const b = await apiFetch(`/messenger/lookup?telegram_id=${m.telegram_id}&username=${encodeURIComponent(m.username || '')}`);
      if(b?.mine) {
        status.innerHTML = `<b>${escapeHtml(b.nickname || m.nickname)}</b> — твой${b.taken_by_other ? ' <span class="muted">(есть и у других)</span>' : ''}<br>` +
          `${escapeHtml(b.status_label || '')} · занёс <b>$${(b.total_deposited || 0)}</b>`;
        add.textContent = '✓ Уже у тебя';
        add.disabled = true;
      } else if(b?.taken_by_other) {
        status.innerHTML = `<b class="muted">Чужой мамонт</b><br><span class="muted">Привязан у другого воркера</span>`;
      } else {
        status.innerHTML = `<span class="muted">Не в CRM.</span> <b>${escapeHtml(m.nickname)}</b>`;
      }
    } catch(e: any) {
      if(e?.message === 'bad-key') { status.innerHTML = '<span class="muted">Ключ слетел — подключись заново.</span>'; }
      else { status.innerHTML = '<span class="muted">CRM недоступна.</span>'; }
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

  // Re-apply rings every ~3s to catch chats that were already in DOM
  if(syncTick % 5 === 0) {
    applyAllRings();
  }
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
  watchDialogList();
  window.setTimeout(async() => { await migrateLegacyHeat(); refreshHeat(); }, 4000);
  window.setInterval(refreshHeat, 20000);
  window.setInterval(sync, 600);
}
