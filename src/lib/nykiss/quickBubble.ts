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

const HEAT_KEY = (peerId: number | string) => `nykiss_heat_${peerId}`;
const HEAT_NAME_KEY = (peerId: number | string) => `nykiss_heat_name_${peerId}`;

const HEAT_OPTS = [
  {key: 'none', color: 'rgba(255,255,255,0.12)', border: 'rgba(255,255,255,0.3)', emoji: '·'},
  {key: 'cold', color: '#2A6B9A', border: '#2A6B9A', emoji: '🧊'},
  {key: 'warm', color: '#C9A227', border: '#C9A227', emoji: '🔥'},
  {key: 'hot',  color: '#E05A20', border: '#E05A20', emoji: '💰'},
] as const;

function applyAllRings() {
  document.querySelectorAll<HTMLElement>('[data-peer-id]').forEach(el => {
    const peerId = el.dataset.peerId;
    const avatarEl = el.querySelector<HTMLElement>('.dialog-avatar');
    if(!avatarEl || !peerId) return;
    const status = localStorage.getItem(HEAT_KEY(peerId));
    if(status) avatarEl.dataset.heat = status;
    else delete avatarEl.dataset.heat;
  });
}

function updateFabRing(telegramId?: number | null) {
  if(!fabEl) return;
  const pid = telegramId ?? currentPeerId;
  const status = pid ? (localStorage.getItem(HEAT_KEY(pid)) ?? 'none') : 'none';
  fabEl.dataset.heat = status;
}

let ringObserver: MutationObserver | null = null;
const FILTER_KEY = 'nykiss_heat_filter';
let filterInited = false;
let filterChipEl: HTMLElement | null = null;

function watchDialogList() {
  if(ringObserver) return;
  const target = document.getElementById('chatlist-container');
  if(!target) return;
  ringObserver = new MutationObserver(() => applyAllRings());
  ringObserver.observe(target, {childList: true, subtree: true});
  applyAllRings();
}

// ---- Hot Filter Chips (3-way: cold / warm / hot) -----------------------------

const HEAT_FILTERS = [
  {key: 'cold', emoji: '🧊', label: 'Холодные'},
  {key: 'warm', emoji: '🔥', label: 'Тёплые'},
  {key: 'hot',  emoji: '💰', label: 'Горячие'},
] as const;

type HeatLevel = typeof HEAT_FILTERS[number]['key'];
let chipBtns: HTMLButtonElement[] = [];

function getActiveFilter(): HeatLevel | '' {
  return (localStorage.getItem(FILTER_KEY) as HeatLevel) || '';
}

function setActiveFilter(key: HeatLevel | '') {
  if(key) localStorage.setItem(FILTER_KEY, key);
  else localStorage.removeItem(FILTER_KEY);
  if(key) showHeatOverlay(key);
  else hideHeatOverlay();
  updateHeatChipBtns();
}

let heatOverlayEl: HTMLElement | null = null;

function showHeatOverlay(filterKey: HeatLevel) {
  hideHeatOverlay();
  const container = document.getElementById('chatlist-container');
  if(!container) return;

  // Collect all stored peers with this heat level from localStorage
  const peers: {id: string, name: string}[] = [];
  for(let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if(!k || !k.startsWith('nykiss_heat_') || k.includes('_name_') || k.includes('_filter')) continue;
    const id = k.replace('nykiss_heat_', '');
    if(localStorage.getItem(k) === filterKey) {
      const name = localStorage.getItem(HEAT_NAME_KEY(id)) || `ID${id}`;
      peers.push({id, name});
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'nykiss-heat-overlay';

  if(!peers.length) {
    const empty = document.createElement('div');
    empty.className = 'nykiss-heat-overlay-empty';
    const labels: Record<string, string> = {cold: 'холодных', warm: 'тёплых', hot: 'горячих'};
    empty.innerHTML = `Нет ${labels[filterKey] || ''} чатов<br><small>Открой чат → N → Статус</small>`;
    overlay.append(empty);
  } else {
    peers.forEach(({id, name}) => {
      const domRow = document.querySelector<HTMLElement>(`[data-peer-id="${id}"]`);
      const item = document.createElement('div');
      item.className = 'nykiss-heat-overlay-item';
      if(domRow) {
        item.innerHTML = domRow.innerHTML;
        domRow.classList.forEach(c => { if(c !== 'is-selected') item.classList.add(c); });
        if(domRow.classList.contains('is-selected')) item.classList.add('is-selected');
      } else {
        item.innerHTML = `<div style="padding:13px 16px 13px 72px;font-size:15px;font-weight:500;">${escapeHtml(name)}</div>`;
      }
      item.addEventListener('click', () => {
        const orig = document.querySelector<HTMLElement>(`[data-peer-id="${id}"]`);
        if(orig) { orig.click(); return; }
        // peer not in DOM — navigate via hash (username stored in name if starts with @)
        try { (appImManager as any).setInnerPeer({peerId: id}); } catch(_) {}
      });
      overlay.append(item);
    });
  }

  // Position inside chatlist container
  const pos = container.style.position;
  if(!pos || pos === 'static') container.style.position = 'relative';
  container.appendChild(overlay);
  heatOverlayEl = overlay;
}

function hideHeatOverlay() {
  heatOverlayEl?.remove();
  heatOverlayEl = null;
}

function updateHeatChipBtns() {
  if(!chipBtns.length) return;
  const active = getActiveFilter();
  HEAT_FILTERS.forEach((f, i) => {
    const btn = chipBtns[i];
    if(!btn) return;
    const count = document.querySelectorAll(`.dialog-avatar[data-heat="${f.key}"]`).length;
    btn.textContent = count > 0 ? `${f.emoji} ${f.label} ${count}` : `${f.emoji} ${f.label}`;
    btn.classList.toggle('is-active', active === f.key);
    btn.style.opacity = (count === 0 && active !== f.key) ? '0.4' : '';
  });
}

function buildHotFilterChip(overlay: HTMLElement) {
  if(overlay.querySelector('.nykiss-heat-chip-row')) return;
  const row = document.createElement('div');
  row.className = 'nykiss-heat-chip-row';

  chipBtns = HEAT_FILTERS.map(f => {
    const btn = document.createElement('button');
    btn.className = 'nykiss-heat-chip';
    btn.dataset.filterKey = f.key;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      applyAllRings();
      setActiveFilter(getActiveFilter() === f.key ? '' : f.key as HeatLevel);
    });
    row.append(btn);
    return btn;
  });

  overlay.append(row);
  applyAllRings();
  updateHeatChipBtns();

  const saved = getActiveFilter();
  if(saved) showHeatOverlay(saved);
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
.nykiss-qb__heat-dot { width:28px; height:28px; border-radius:50%; border:2px solid transparent;
  cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center;
  transition:transform .15s, box-shadow .15s; flex-shrink:0; }
.nykiss-qb__heat-dot:hover { transform:scale(1.15); }
.nykiss-qb__heat-dot.is-active { transform:scale(1.28) !important;
  box-shadow:0 0 0 2.5px rgba(255,255,255,0.4); }

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

/* Hot Filter Chips — 3 in a row */
.nykiss-heat-chip-row { display: flex; padding: 6px 10px 4px; gap: 6px; flex-shrink: 0; }
.nykiss-heat-chip { display: inline-flex; align-items: center; padding: 4px 11px;
  border-radius: 20px; font-size: 12.5px; font-weight: 600; cursor: pointer;
  background: rgba(255,255,255,.07); color: var(--secondary-text-color, rgba(255,255,255,.55));
  border: 1.5px solid rgba(255,255,255,.12); transition: all .18s; user-select: none; white-space: nowrap;
  flex: 1; justify-content: center; min-width: 0; }
.nykiss-heat-chip:hover { opacity: .85; }
.nykiss-heat-chip[data-filter-key="cold"].is-active { background: rgba(42,107,154,.25); border-color: #2A6B9A; color: #5ba8d4; box-shadow: 0 0 8px rgba(42,107,154,.3); }
.nykiss-heat-chip[data-filter-key="warm"].is-active { background: rgba(201,162,39,.25); border-color: #C9A227; color: #D4A827; box-shadow: 0 0 8px rgba(201,162,39,.3); }
.nykiss-heat-chip[data-filter-key="hot"].is-active  { background: rgba(224,90,32,.25);  border-color: #E05A20; color: #FF6B30; box-shadow: 0 0 8px rgba(224,90,32,.3); }
/* Heat overlay — full-screen panel over chatlist showing only heat chats */
.nykiss-heat-overlay { position: absolute; inset: 0; z-index: 50;
  background: var(--surface-color, #141414); overflow-y: auto; display: flex; flex-direction: column; }
.nykiss-heat-overlay-empty { padding: 40px 20px; text-align: center; opacity: .45;
  font-size: 14px; line-height: 1.5; }
.nykiss-heat-overlay-item { cursor: pointer; position: relative; }
.nykiss-heat-overlay-item:hover { background: rgba(255,255,255,.04); }
.nykiss-heat-overlay-item.is-selected { background: var(--secondary-surface-color, rgba(255,255,255,.06)); }
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

    // Heat Pulse — status picker
    const heatRow = document.createElement('div');
    heatRow.className = 'nykiss-qb__heat';
    const heatLabel = document.createElement('span');
    heatLabel.style.cssText = 'font-size:11px;opacity:.45;text-transform:uppercase;letter-spacing:.06em;flex:1;';
    heatLabel.textContent = 'Статус';
    heatRow.append(heatLabel);
    const currentHeat = localStorage.getItem(HEAT_KEY(m.telegram_id)) ?? 'none';
    HEAT_OPTS.forEach(opt => {
      const dot = document.createElement('button');
      dot.className = 'nykiss-qb__heat-dot' + (currentHeat === opt.key ? ' is-active' : '');
      dot.style.cssText = `background:${opt.color};border-color:${opt.border};`;
      dot.title = opt.key;
      dot.textContent = opt.emoji;
      dot.addEventListener('click', e => {
        e.stopPropagation();
        if(opt.key === 'none') {
          localStorage.removeItem(HEAT_KEY(m.telegram_id));
          localStorage.removeItem(HEAT_NAME_KEY(m.telegram_id));
        } else {
          localStorage.setItem(HEAT_KEY(m.telegram_id), opt.key);
          localStorage.setItem(HEAT_NAME_KEY(m.telegram_id), m.nickname || String(m.telegram_id));
        }
        applyAllRings();
        updateFabRing(m.telegram_id);
        if(getActiveFilter()) { showHeatOverlay(getActiveFilter() as HeatLevel); updateHeatChipBtns(); }
        renderMenu();
      });
      heatRow.append(dot);
    });
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
  }

  // Re-apply rings every ~3s to catch chats that were already in DOM
  if(syncTick % 5 === 0) {
    applyAllRings();
    updateHeatChipBtns();
  }

  if(!filterInited) {
    const overlay = document.querySelector<HTMLElement>('.chatlist-overlay');
    if(overlay) { filterInited = true; buildHotFilterChip(overlay); }
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
  window.setInterval(sync, 600);
}
