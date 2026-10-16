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
import rootScope from '@lib/rootScope';
import getPeerActiveUsernames from '@appManagers/utils/peers/getPeerActiveUsernames';
import {planFolders, FOLDER_CAP, LEGACY_HEAT_FOLDER_TITLES, HEAT_FOLDER_TITLES, HEAT_FOLDER_EMOTICONS, HeatKey} from '@lib/nykiss/heatFolders';

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
  // only a мамонт the CRM knows gets a ring (cold = blue, small); everybody else stays bare
  const heat = knownHeat(peerId);
  const cur = el.dataset.heat;
  if(!heat) { if(cur) delete el.dataset.heat; } else if(cur !== heat) el.dataset.heat = heat;
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

// The CRM's temperature of a chat, or null when the CRM does not know him (not attached).
function knownHeat(peerId: number | string | null | undefined): Heat | null {
  if(peerId == null) return null;
  const id = String(peerId);
  const byId = heatMap.get(id);
  if(byId) return byId;
  const name = peerUsername.get(id);
  return (name && heatByName.get(name)) || null;
}

// The ring of the N button exists only for a мамонт that is in the CRM (cold included).
function updateFabRing(telegramId?: number | null) {
  if(!fabEl) return;
  const heat = knownHeat(telegramId ?? currentPeerId);
  if(heat) fabEl.dataset.heat = heat;
  else delete fabEl.dataset.heat;
}

// ---- Heat folders: real Telegram folders «Тёплые» / «Горячие» -----------------
// The CRM owns them: content = exactly the chats with that temperature (see heatFolders.ts).
// Cold chats have no folder. Folders live on the Telegram account, so they follow the operator everywhere.

let folderDirty = false;
let folderRunning: Promise<void> | null = null;

// What the folders must hold: `owned` = every chat the CRM gives that temperature, `want` = those tweb can address.
async function computeFolderTargets() {
  const {appUsersManager} = appImManager.managers;
  const want: Record<HeatKey, number[]> = {warm: [], hot: []};
  const owned: Record<HeatKey, number[]> = {warm: [], hot: []};
  for(const [id, heat] of allHeat()) {
    if(heat === 'cold') continue;
    owned[heat].push(+id);
    const user: any = await appUsersManager.getUser(+id);
    // a chat can only join a folder when tweb holds its access hash
    if(user && (user.access_hash || user.pFlags?.self) && want[heat].length < FOLDER_CAP) want[heat].push(+id);
  }
  return {want, owned};
}

async function runFolderPass() {
  const {filtersStorage: fs, appPeersManager} = appImManager.managers;
  const {want, owned} = await computeFolderTargets();

  const fresh: any[] = (await fs.getDialogFilters(true)).filter((f: any) => f._ === 'dialogFilter' && f.id > 1);
  const ops = planFolders(fresh.map(f => ({
    id: f.id,
    title: f.title?.text || '',
    includePeerIds: f.includePeerIds || [],
    pinnedPeerIds: f.pinnedPeerIds || [],
    excludePeerIds: f.excludePeerIds || [],
    flags: Object.keys(f.pFlags || {}).filter(k => (f.pFlags as any)[k]),
    hasColor: f.color != null
  })), want, owned);

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

  await orderFolders();
}

// «Все» stays first, then «Тёплые», then «Горячие», then the user's own folders in their order.
async function orderFolders() {
  const fs = appImManager.managers.filtersStorage;
  const custom: any[] = (await fs.getDialogFilters(true))
  .filter((f: any) => f.id > 1)
  .sort((a: any, b: any) => (a.localId ?? 0) - (b.localId ?? 0));
  const rank = (f: any) => f.title?.text === HEAT_FOLDER_TITLES.warm ? 0 : f.title?.text === HEAT_FOLDER_TITLES.hot ? 1 : 2;
  const wanted = custom.map((f, i) => ({f, i})).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map(x => x.f.id);
  if(wanted.every((id, i) => id === custom[i].id)) return;
  // the app keeps «Все» first for everybody but premium, where it is part of the order
  await fs.updateDialogFiltersOrder([...(rootScope.premium ? [0] : []), ...wanted]);
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
        if(navigator.locks) await navigator.locks.request('nykiss-heat-folders-v3', runFolderPass);
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
// shown in the menu header and the console: the first thing to check when something "does not update"
const BUILD: string = String((import.meta as any).env?.VITE_NYKISS_SHA || 'dev').slice(0, 7);

const SPRITE = `<svg id="nykiss-qb-sprite" width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="ic-cold" viewBox="0 0 24 24"><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.8 12 7l2.5-2.2M9.5 19.2 12 17l2.5 2.2"/></symbol>
<symbol id="ic-warm" viewBox="0 0 24 24"><path d="M12 2.8c.7 3.6-3.2 5.6-4.9 9-1.6 3.3.2 8.2 4.9 8.2s6-4.2 4.8-7.3c-.6 1.3-1.6 2-2.7 2-1.6-1.8 1.2-6.6-2.1-11.9Z"/><path d="M12 20.2c-2 0-3.2-1.3-3.2-3 0-1.5 1.5-2.5 3.2-4.3 1.7 1.8 3.2 2.8 3.2 4.3 0 1.7-1.2 3-3.2 3Z"/></symbol>
<symbol id="ic-hot" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="5.4" stroke-dasharray="1.6 1.6"/><path d="M12 9.5v5"/></symbol>
<symbol id="ic-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="ic-check" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.3 2.4 2.4 4.6-5"/></symbol>
<symbol id="ic-lock" viewBox="0 0 24 24"><rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></symbol>
<symbol id="ic-link" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></symbol>
</svg>`;

function ic(name: string, cls = ''): string {
  return `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" aria-hidden="true"><use href="#ic-${name}"/></svg>`;
}

function injectStyle() {
  if(document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.nykiss-qb{
  --nq-gold:#C9A227; --nq-gold-hi:#e9c860; --nq-gold-lo:#8a6d14;
  --nq-ink:#070807; --nq-surface:#12110b; --nq-surface-2:#1a1810;
  --nq-text:#F3EEDF; --nq-muted:#9a927d; --nq-line:#241f12; --nq-hair:rgba(201,162,39,.28);
  --nq-cold:#68a6d9; --nq-warm:#e8a23a; --nq-hot:#e5532d; --nq-green:#32a271; --nq-red:#c0525b;
  --nq-fab:52px; --nq-gap:12px;
  position:fixed; z-index:5; display:none;
  right:max(16px, env(safe-area-inset-right));
  bottom:calc(104px + env(safe-area-inset-bottom));
  font-family:Manrope,var(--font-family,system-ui),sans-serif;
  -webkit-user-select:none;user-select:none; -webkit-tap-highlight-color:transparent;
}
.nykiss-qb.is-visible{display:block}
.nykiss-qb svg{display:block;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.nykiss-qb button{font-family:inherit}

/* --- FAB --- */
.nykiss-qb__fab{position:relative;width:var(--nq-fab);height:var(--nq-fab);padding:0;border:0;border-radius:50%;cursor:pointer;
  display:grid;place-items:center;color:#1a1206;
  font:600 25px/1 Fraunces,Georgia,serif;
  background:radial-gradient(120% 120% at 30% 22%,#f6e8ba 0%,#d8b451 42%,#a07d23 100%);
  box-shadow:0 8px 22px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.45),inset 0 -2px 4px rgba(90,60,0,.35);
  outline:2px solid transparent;outline-offset:3px;
  transition:transform .2s cubic-bezier(.2,.8,.2,1),outline-color .25s;}
.nykiss-qb__fab:hover{transform:translateY(-1px)}
.nykiss-qb__fab:active{transform:scale(.95)}
.nykiss-qb__fab:focus-visible{outline-color:var(--nq-text)}
.nykiss-qb__fab-n{transition:transform .25s cubic-bezier(.2,.8,.2,1)}
.nykiss-qb.is-open .nykiss-qb__fab-n{transform:scale(.92)}
.nykiss-qb.is-open .nykiss-qb__fab{box-shadow:0 4px 12px rgba(0,0,0,.6),inset 0 2px 5px rgba(90,60,0,.45)}
/* ring: gap + thin colored line, + corner badge so it is not color-only */
.nykiss-qb__fab[data-heat=cold]{outline-color:var(--nq-cold)}
.nykiss-qb__fab[data-heat=warm]{outline-color:var(--nq-warm)}
.nykiss-qb__fab[data-heat=hot]{outline-color:var(--nq-hot);animation:nq-ember 2.6s ease-in-out infinite}
@keyframes nq-ember{0%,100%{box-shadow:0 8px 22px rgba(0,0,0,.55),0 0 0 0 rgba(229,83,45,0),inset 0 1px 0 rgba(255,255,255,.45),inset 0 -2px 4px rgba(90,60,0,.35)}
  50%{box-shadow:0 8px 22px rgba(0,0,0,.55),0 0 0 9px rgba(229,83,45,.14),inset 0 1px 0 rgba(255,255,255,.45),inset 0 -2px 4px rgba(90,60,0,.35)}}
.nykiss-qb__badge{position:absolute;right:-6px;top:-6px;width:20px;height:20px;border-radius:50%;display:none;place-items:center;
  background:var(--nq-ink);box-shadow:0 0 0 1.5px currentColor}
.nykiss-qb__badge svg{width:12px;height:12px}
.nykiss-qb__fab[data-heat=cold] .nykiss-qb__badge{display:grid;color:var(--nq-cold)}
.nykiss-qb__fab[data-heat=warm] .nykiss-qb__badge{display:grid;color:var(--nq-warm)}
.nykiss-qb__fab[data-heat=hot]  .nykiss-qb__badge{display:grid;color:var(--nq-hot)}
.nykiss-qb__badge>svg{display:none}
.nykiss-qb__fab[data-heat=cold] .i-cold,.nykiss-qb__fab[data-heat=warm] .i-warm,.nykiss-qb__fab[data-heat=hot] .i-hot{display:block}

/* --- CHIP --- */
.nykiss-qb__chip{position:absolute;right:0;bottom:calc(var(--nq-fab) + 14px);display:none;align-items:center;gap:6px;white-space:nowrap;
  height:26px;padding:0 10px 0 8px;border-radius:5px;background:var(--nq-surface);color:var(--nq-text);
  font:700 12px/1 Manrope,sans-serif;letter-spacing:.01em;
  box-shadow:0 6px 16px rgba(0,0,0,.5),inset 0 0 0 1px var(--nq-hair);
  animation:nq-chip .22s cubic-bezier(.2,.8,.2,1);}
.nykiss-qb__chip svg{width:14px;height:14px;flex:none}
.nykiss-qb__chip.is-shown{display:inline-flex}
.nykiss-qb__chip b{font-variant-numeric:tabular-nums;font-weight:800;color:var(--nq-gold-hi)}
.nykiss-qb__chip.is-mine svg{color:var(--nq-green)}
.nykiss-qb__chip.is-none{color:var(--nq-muted)}
.nykiss-qb__chip.is-none svg{color:var(--nq-gold)}
.nykiss-qb__chip.is-foreign{color:#e6b3b6;box-shadow:0 6px 16px rgba(0,0,0,.5),inset 0 0 0 1px rgba(192,82,91,.5)}
.nykiss-qb__chip.is-foreign svg{color:var(--nq-red)}
.nykiss-qb.is-open .nykiss-qb__chip{display:none}
@keyframes nq-chip{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}

/* --- MENU --- */
.nykiss-qb__menu{zoom:.9;position:absolute;right:0;bottom:calc(var(--nq-fab) + var(--nq-gap));
  width:min(320px,calc(100vw - 32px));max-height:calc(100vh - 104px - var(--nq-fab) - var(--nq-gap) - 56px);overflow:auto;
  background:var(--nq-surface);color:var(--nq-text);border-radius:6px;
  box-shadow:0 22px 60px rgba(0,0,0,.7),0 0 0 1px var(--nq-hair);
  transform-origin:100% 100%;opacity:0;transform:translateY(10px) scale(.97);pointer-events:none;visibility:hidden;
  transition:opacity .18s ease,transform .22s cubic-bezier(.2,.8,.2,1),visibility 0s .22s;}
.nykiss-qb.is-open .nykiss-qb__menu{opacity:1;transform:none;pointer-events:auto;visibility:visible;transition-delay:0s}
.nykiss-qb__menu::before{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;opacity:.5;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
/* top accent bar: color = temperature */
.nykiss-qb__menu::after{content:"";position:absolute;left:0;right:0;top:0;height:2px;border-radius:6px 6px 0 0;background:var(--nq-gold);opacity:.9}
.nykiss-qb__menu[data-heat=cold]::after{background:var(--nq-cold)}
.nykiss-qb__menu[data-heat=warm]::after{background:var(--nq-warm)}
.nykiss-qb__menu[data-heat=hot]::after{background:var(--nq-hot)}
.nykiss-qb__menu[data-kind=foreign]::after{background:var(--nq-red)}

.nykiss-qb__head{display:flex;align-items:center;gap:8px;padding:14px 16px 0;
  font:800 10.5px/1 Manrope,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:var(--nq-gold)}
.nykiss-qb__head i{flex:1;height:1px;background:var(--nq-line)}
.nykiss-qb__who{padding:12px 16px 14px}
.nykiss-qb__name{margin:0;font:600 23px/1.15 Fraunces,Georgia,serif;color:var(--nq-text);letter-spacing:-.005em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nykiss-qb__sub{margin-top:4px;font:500 12.5px/1.3 Manrope,sans-serif;color:var(--nq-muted)}

.nykiss-qb__stats{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--nq-line);border-bottom:1px solid var(--nq-line)}
.nykiss-qb__stat{padding:11px 16px 12px}
.nykiss-qb__stat+.nykiss-qb__stat{border-left:1px solid var(--nq-line)}
.nykiss-qb__lbl{font:700 10px/1 Manrope,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--nq-muted)}
.nykiss-qb__val{margin-top:7px;font:600 17px/1.1 Manrope,sans-serif;font-variant-numeric:tabular-nums;color:var(--nq-text)}
.nykiss-qb__val.is-money{font:600 22px/1 Fraunces,Georgia,serif;color:var(--nq-gold-hi)}

.nykiss-qb__sec{padding:14px 16px 4px}
.nykiss-qb__sec .nykiss-qb__lbl{margin-bottom:9px;display:flex;justify-content:space-between}
.nykiss-qb__sec .nykiss-qb__lbl em{font-style:normal;letter-spacing:.06em;text-transform:none;font-weight:600}

/* segmented heat control: 3 steps, 3rd is locked */
.nykiss-qb__seg{position:relative;display:grid;grid-template-columns:repeat(3,1fr);padding:3px;border-radius:5px;
  background:#0a0a07;box-shadow:inset 0 0 0 1px var(--nq-line),inset 0 2px 6px rgba(0,0,0,.5)}
.nykiss-qb__thumb{position:absolute;top:3px;bottom:3px;left:3px;width:calc((100% - 6px)/3);border-radius:3px;
  background:var(--nq-surface-2);box-shadow:inset 0 0 0 1px currentColor,0 3px 8px rgba(0,0,0,.5);
  transition:transform .28s cubic-bezier(.2,.8,.2,1),color .2s;color:var(--nq-cold)}
.nykiss-qb__seg[data-v=cold] .nykiss-qb__thumb{transform:translateX(0);color:var(--nq-cold)}
.nykiss-qb__seg[data-v=warm] .nykiss-qb__thumb{transform:translateX(100%);color:var(--nq-warm)}
.nykiss-qb__seg[data-v=hot]  .nykiss-qb__thumb{transform:translateX(200%);color:var(--nq-hot);
  background:linear-gradient(180deg,rgba(229,83,45,.2),rgba(229,83,45,.08))}
.nykiss-qb__opt{position:relative;z-index:1;min-height:56px;padding:8px 2px;border:0;background:none;cursor:pointer;color:var(--nq-muted);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;
  font:700 12px/1 Manrope,sans-serif;transition:color .2s}
.nykiss-qb__opt svg{width:20px;height:20px}
.nykiss-qb__opt:hover{color:var(--nq-text)}
.nykiss-qb__opt[aria-checked=true]{cursor:default}
.nykiss-qb__opt[data-k=cold][aria-checked=true]{color:var(--nq-cold)}
.nykiss-qb__opt[data-k=warm][aria-checked=true]{color:var(--nq-warm)}
.nykiss-qb__opt[data-k=hot]{cursor:not-allowed;color:#5d5748}
.nykiss-qb__opt[data-k=hot][aria-checked=true]{color:var(--nq-hot);cursor:default}
.nykiss-qb__opt[data-k=hot] .lock{position:absolute;right:7px;top:7px;width:11px;height:11px;opacity:.8}
.nykiss-qb__opt:focus-visible{outline:2px solid var(--nq-gold-hi);outline-offset:-2px;border-radius:3px}
.nykiss-qb__seg.is-busy .nykiss-qb__opt{pointer-events:none}
.nykiss-qb__seg.is-busy .nykiss-qb__thumb{opacity:.7}
.nykiss-qb__note{padding:10px 16px 16px;font:500 12.5px/1.45 Manrope,sans-serif;color:var(--nq-muted)}
.nykiss-qb__note b{color:var(--nq-text);font-weight:700}

/* paid seal */
.nykiss-qb__seal{margin:12px 16px 0;padding:10px 12px;display:flex;gap:11px;align-items:center;border-radius:4px;
  box-shadow:inset 0 0 0 1px rgba(229,83,45,.45);background:rgba(229,83,45,.07)}
.nykiss-qb__seal svg{width:26px;height:26px;color:var(--nq-hot);flex:none}
.nykiss-qb__seal strong{display:block;font:800 11px/1 Manrope;letter-spacing:.16em;text-transform:uppercase;color:#f07a54}
.nykiss-qb__seal span{display:block;margin-top:5px;font:500 12.5px/1.35 Manrope;color:var(--nq-muted)}

/* buttons */
.nykiss-qb__cta{display:flex;align-items:center;justify-content:center;gap:9px;width:calc(100% - 32px);margin:0 16px 16px;min-height:48px;
  border:0;border-radius:4px;cursor:pointer;color:#1a1206;font:800 14px/1 Manrope,sans-serif;letter-spacing:.01em;
  background:linear-gradient(180deg,#e9c860 0%,#cfa73a 55%,#b8902a 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 6px 16px rgba(201,162,39,.18);
  position:relative;overflow:hidden;transition:transform .12s,filter .15s}
.nykiss-qb__cta svg{width:18px;height:18px}
.nykiss-qb__cta:hover{filter:brightness(1.07)}
.nykiss-qb__cta:active{transform:scale(.985)}
.nykiss-qb__cta::after{content:"";position:absolute;top:0;bottom:0;width:40%;left:-60%;transform:skewX(-20deg);
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent)}
.nykiss-qb__cta:hover::after{left:130%;transition:left .6s ease}
.nykiss-qb__cta:disabled{filter:saturate(.5) brightness(.8);cursor:default}
.nykiss-qb__spin{width:16px;height:16px;border-radius:50%;border:2px solid rgba(26,18,6,.3);border-top-color:#1a1206;animation:nq-spin .7s linear infinite}
@keyframes nq-spin{to{transform:rotate(360deg)}}
.nykiss-qb__cta:focus-visible{outline:2px solid var(--nq-text);outline-offset:2px}
.nykiss-qb__hint{padding:12px 16px 16px;font:500 13px/1.5 Manrope,sans-serif;color:var(--nq-muted)}
.nykiss-qb__hint b{color:var(--nq-text)}
.nykiss-qb__lock{margin:14px 16px 16px;padding:11px 12px;display:flex;gap:10px;align-items:flex-start;border-radius:4px;
  box-shadow:inset 0 0 0 1px rgba(192,82,91,.4);background:rgba(192,82,91,.07);font:500 12.5px/1.45 Manrope;color:#d9b3b6}
.nykiss-qb__lock svg{width:18px;height:18px;color:var(--nq-red);flex:none;margin-top:1px}
.nykiss-qb__err{margin:-6px 16px 14px;font:600 12px/1.35 Manrope;color:#e6a1a1}
.nykiss-qb__pill{display:inline-flex;align-items:center;gap:6px}
.nykiss-qb__dot{width:6px;height:6px;border-radius:50%;background:currentColor}

@media (max-width:480px){
  .nykiss-qb{right:max(14px,env(safe-area-inset-right))}
  .nykiss-qb__menu{width:calc(100vw - 28px);right:0}
}
@media (prefers-reduced-motion:reduce){.nykiss-qb *{animation:none!important;transition-duration:.01s!important}}
.nykiss-qb__build{font:600 9px/1 Manrope,sans-serif;letter-spacing:.08em;text-transform:none;color:#5d5748}

`;
  document.head.appendChild(style);
  document.body.insertAdjacentHTML('beforeend', SPRITE);
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

function closeMenu() {
  rootEl.classList.remove('is-open');
  fabEl.setAttribute('aria-expanded', 'false');
}
function openMenu() {
  rootEl.classList.add('is-open');
  fabEl.setAttribute('aria-expanded', 'true');
  renderMenu();
}
function toggleMenu() { rootEl.classList.contains('is-open') ? closeMenu() : openMenu(); }

// --- connect flow ---
async function promptConnect() {
  const key = window.prompt('Вставь ключ NYKISS Gram (Настройки → NYKISS Gram — ключ в мини-аппе):');
  if(!key || !key.trim()) return;
  setKey(key.trim());
  try {
    await apiFetch('/messenger/whoami');
  } catch(e) {
    setKey('');
    window.alert('Ключ не подошёл. Проверь и вставь заново.');
  }
  renderMenu();
  refreshBadge();
  refreshHeat();
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
  btn.innerHTML = '<i class="nykiss-qb__spin"></i>Добавляю…';
  setErr(errEl, '');
  try {
    await apiFetch('/messenger/mammoths', {
      method: 'POST',
      body: JSON.stringify({nickname: m.nickname, telegram_username: m.username, telegram_id: m.telegram_id})
    });
    refreshBadge();
    refreshHeat();
    renderMenu(); // the temperature switch appears right away
  } catch(e: any) {
    btn.disabled = false;
    btn.innerHTML = ic('plus') + 'Добавить мамонта';
    setErr(errEl, e?.message === 'bad-key' ? errText(e) : 'Не удалось добавить.');
  }
}

// --- menu ---

const HEAT_NOTES: Record<Heat, string> = {
  cold: 'Ещё не созрел. Переведи в <b>«Тёплый»</b>, когда он готов платить.',
  warm: 'Ждёт оплату. Чат лежит в папке <b>«Тёплые»</b>.',
  hot: ''
};
// the CRM labels carry an emoji ("🆕 Новый"); the interface has none
const plainLabel = (s: string) => (s || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();

const menuHead = () =>
  `<div class="nykiss-qb__head" title="build ${BUILD}">NYKISS CRM<i></i><span class="nykiss-qb__build">${BUILD}</span></div>`;
const menuWho = (name: string, sub: string) =>
  `<div class="nykiss-qb__who"><h3 class="nykiss-qb__name">${escapeHtml(name)}</h3><div class="nykiss-qb__sub">${escapeHtml(sub)}</div></div>`;
const statusRow = (label: string, value: string, color = '') =>
  `<div class="nykiss-qb__stats"><div class="nykiss-qb__stat" style="grid-column:1/-1"><div class="nykiss-qb__lbl">${label}</div>` +
  `<div class="nykiss-qb__val"${color ? ` style="color:${color}"` : ''}>${value}</div></div></div>`;

function setMenu(kind: string, heat: string, html: string) {
  menuEl.dataset.kind = kind;
  if(heat) menuEl.dataset.heat = heat;
  else delete menuEl.dataset.heat;
  menuEl.innerHTML = html;
}

function segHtml(heat: Heat): string {
  const opt = (k: Heat, text: string) =>
    `<button class="nykiss-qb__opt" role="radio" data-k="${k}" aria-checked="${heat === k}"` +
    (k === 'hot' ? ' aria-disabled="true" tabindex="-1" title="Ставится автоматически после оплаты"' : '') +
    `>${ic(k)}<span>${text}</span>${k === 'hot' && heat !== 'hot' ? ic('lock', 'lock') : ''}</button>`;
  return `<div class="nykiss-qb__seg" role="radiogroup" aria-label="Температура" data-v="${heat}"><i class="nykiss-qb__thumb"></i>` +
    `${opt('cold', 'Холодный')}${opt('warm', 'Тёплый')}${opt('hot', 'Горячий')}</div>`;
}

// Cold (default) / warm (manual) are switchable; hot only shows — it comes from money.
function wireHeatSwitch(m: OpenMammoth, heat: Heat) {
  const seg = menuEl.querySelector<HTMLElement>('.nykiss-qb__seg');
  const note = menuEl.querySelector<HTMLElement>('.nykiss-qb__note');
  const errEl = menuEl.querySelector<HTMLElement>('.nykiss-qb__err');
  if(!seg || heat === 'hot') return;
  const peerKey = String(m.telegram_id);
  let current = heat;

  const paint = (h: Heat) => {
    current = h;
    seg.dataset.v = h;
    menuEl.dataset.heat = h;
    seg.querySelectorAll<HTMLElement>('.nykiss-qb__opt').forEach(o => o.setAttribute('aria-checked', String(o.dataset.k === h)));
    if(note) note.innerHTML = HEAT_NOTES[h];
  };

  seg.querySelectorAll<HTMLElement>('.nykiss-qb__opt[data-k="cold"], .nykiss-qb__opt[data-k="warm"]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const key = btn.dataset.k as Heat;
      if(key === current || seg.classList.contains('is-busy')) return;
      const prev = current;
      setErr(errEl, '');
      seg.classList.add('is-busy');
      paint(key); // optimistic: the ring and the switch answer at once
      heatMap.set(peerKey, key);
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
        heatMap.set(peerKey, prev);
        applyAllRings();
        updateFabRing(m.telegram_id);
        setErr(errEl, errText(err));
      } finally { seg.classList.remove('is-busy'); }
    });
  });
}

function paintMine(m: OpenMammoth, b: any) {
  const heat = (b.heat || 'cold') as Heat;
  const sub = [m.username ? '@' + m.username : '', 'id ' + m.telegram_id].filter(Boolean).join(' · ') +
    (b.taken_by_other ? ' · есть и у других' : '');
  setMenu('mine', heat, menuHead() + menuWho(b.nickname || m.nickname, sub) +
    `<div class="nykiss-qb__stats"><div class="nykiss-qb__stat"><div class="nykiss-qb__lbl">Занёс</div>` +
    `<div class="nykiss-qb__val is-money">$${b.total_deposited || 0}</div></div>` +
    `<div class="nykiss-qb__stat"><div class="nykiss-qb__lbl">Статус</div>` +
    `<div class="nykiss-qb__val">${escapeHtml(plainLabel(b.status_label)) || '—'}</div></div></div>` +
    `<div class="nykiss-qb__sec"><div class="nykiss-qb__lbl">Температура</div>${segHtml(heat)}</div>` +
    (heat === 'hot'
      ? `<div class="nykiss-qb__seal">${ic('hot')}<div><strong>Оплачено</strong><span>Ставится сам, когда приходит оплата.</span></div></div><div style="height:16px"></div>`
      : `<div class="nykiss-qb__note">${HEAT_NOTES[heat]}</div>`) +
    '<div class="nykiss-qb__err" style="display:none"></div>');
  wireHeatSwitch(m, heat);
}

function paintNone(m: OpenMammoth) {
  const sub = [m.username ? '@' + m.username : '', 'id ' + m.telegram_id].filter(Boolean).join(' · ');
  // not in the CRM: only «Добавить» — the temperature appears once he is attached
  setMenu('none', '', menuHead() + menuWho(m.nickname, sub) + statusRow('Статус', 'Не в CRM', 'var(--nq-muted)') +
    '<div class="nykiss-qb__note">Добавь его на свой аккаунт. Температура появится сразу после.</div>' +
    `<button class="nykiss-qb__cta" data-a="add">${ic('plus')}Добавить мамонта</button>` +
    '<div class="nykiss-qb__err" style="display:none"></div>');
  const add = menuEl.querySelector<HTMLButtonElement>('[data-a="add"]');
  const errEl = menuEl.querySelector<HTMLElement>('.nykiss-qb__err');
  add.addEventListener('click', e => { e.stopPropagation(); addMammoth(add, errEl); });
}

function paintForeign(m: OpenMammoth) {
  const sub = [m.username ? '@' + m.username : '', 'id ' + m.telegram_id].filter(Boolean).join(' · ');
  setMenu('foreign', '', menuHead() + menuWho(m.nickname, sub) + statusRow('Статус', 'Чужой мамонт', '#e6a1a1') +
    `<div class="nykiss-qb__lock">${ic('lock')}<div>Привязан к другому воркеру. Добавить или менять температуру нельзя.</div></div>`);
}

// Only the newest call may touch the menu: it awaits the chat and the CRM, and a stale one would
// paint over the fresh state.
let renderSeq = 0;
async function renderMenu() {
  const seq = ++renderSeq;
  const m = getKey() ? await getOpenMammoth() : null;
  if(seq !== renderSeq) return;

  if(!getKey()) {
    setMenu('nokey', '', menuHead() +
      '<div class="nykiss-qb__hint">Подключи CRM один раз, и мамонтов можно будет <b>добавлять прямо из чата</b> на свой аккаунт.</div>' +
      `<button class="nykiss-qb__cta" data-a="connect">${ic('link')}Подключить CRM</button>`);
    menuEl.querySelector('[data-a="connect"]').addEventListener('click', e => { e.stopPropagation(); promptConnect(); });
    return;
  }
  if(!m) {
    setMenu('none', '', menuHead() + '<div class="nykiss-qb__hint">Открой личный чат с мамонтом, чтобы добавить его в CRM.</div>');
    return;
  }

  const sub = [m.username ? '@' + m.username : '', 'id ' + m.telegram_id].filter(Boolean).join(' · ');
  setMenu('none', '', menuHead() + menuWho(m.nickname, sub) + statusRow('Статус', '…'));
  let b: any;
  try {
    b = await apiFetch(`/messenger/lookup?telegram_id=${m.telegram_id}&username=${encodeURIComponent(m.username || '')}`);
  } catch(e: any) {
    if(seq !== renderSeq) return;
    setMenu('none', '', menuHead() + menuWho(m.nickname, sub) +
      `<div class="nykiss-qb__hint">${e?.message === 'bad-key' ? 'Ключ слетел — подключись заново.' : 'CRM недоступна.'}</div>`);
    return;
  }
  if(seq !== renderSeq) return;
  if(b?.mine) paintMine(m, b);
  else if(b?.taken_by_other) paintForeign(m);
  else paintNone(m);
}

function escapeHtml(s: string): string {
  return (s || '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'} as any)[c]);
}

// --- chip (always-visible status above FAB) ---
function setChip(kind: 'mine' | 'none' | 'foreign' | '', money = 0) {
  chipEl.className = 'nykiss-qb__chip';
  if(!kind) { chipEl.innerHTML = ''; return; }
  chipEl.innerHTML = kind === 'mine' ? ic('check') + `<span>твой · <b>$${money}</b></span>`
    : kind === 'foreign' ? ic('lock') + '<span>чужой мамонт</span>'
      : ic('plus') + '<span>не в CRM</span>';
  chipEl.className = 'nykiss-qb__chip is-shown is-' + kind;
}

async function refreshBadge() {
  setChip('');
  if(!getKey()) return;
  const m = await getOpenMammoth();
  if(!m) return;
  const forThis = currentPeerId;
  try {
    const b = await apiFetch(`/messenger/lookup?telegram_id=${m.telegram_id}&username=${encodeURIComponent(m.username || '')}`);
    if(currentPeerId !== forThis) return; // chat switched mid-request
    if(b?.mine) setChip('mine', b.total_deposited || 0);
    else if(b?.taken_by_other) setChip('foreign');
    else setChip('none');
  } catch(e) { /* keep hidden on error */ }
}

// --- diagnostics: window.nykissDebug() prints what the account's folders and the CRM look like;
// window.nykissRepair() deletes our folders and builds them again from the CRM ---
async function nykissDebug() {
  const fs = appImManager.managers.filtersStorage;
  const [ui, srv]: any[][] = [await fs.getDialogFilters(false), await fs.getDialogFilters(true)];
  const row = (f: any) => ({
    id: f.id, kind: f._, title: f.title?.text, emoticon: f.emoticon, color: f.color,
    flags: Object.keys(f.pFlags || {}).join(','), inc: f.includePeerIds?.length, pin: f.pinnedPeerIds?.length, exc: f.excludePeerIds?.length
  });
  const counts: Record<string, number> = {};
  allHeat().forEach(h => { counts[h] = (counts[h] || 0) + 1; });
  const {want, owned} = await computeFolderTargets();
  const ours = srv.filter((f: any) => (Object.values(HEAT_FOLDER_TITLES) as string[]).includes(f.title?.text));
  const seen = new Map<number, string[]>();
  ours.forEach((f: any) => [...(f.pinnedPeerIds || []), ...(f.includePeerIds || [])].forEach((id: number) => {
    seen.set(id, [...(seen.get(id) || []), f.title.text]);
  }));
  const inManyFolders = [...seen].filter(([, t]) => t.length > 1);
  console.info('[nykiss] build', BUILD, '| key', !!getKey(), '| heat', counts, '| by @username only', heatByName.size);
  console.info('[nykiss] folders as the app shows them'); console.table(ui.map(row));
  console.info('[nykiss] folders on the server'); console.table(srv.map(row));
  console.info('[nykiss] plan', planFolders(srv.filter((f: any) => f._ === 'dialogFilter' && f.id > 1).map((f: any) => ({
    id: f.id, title: f.title?.text || '', includePeerIds: f.includePeerIds || [], pinnedPeerIds: f.pinnedPeerIds || [],
    excludePeerIds: f.excludePeerIds || [], flags: Object.keys(f.pFlags || {}), hasColor: f.color != null
  })), want, owned), '| chats in more than one of our folders:', inManyFolders);
  return {build: BUILD, heat: counts, want, owned, inManyFolders};
}

async function nykissRepair() {
  const fs = appImManager.managers.filtersStorage;
  const titles: string[] = [...Object.values(HEAT_FOLDER_TITLES), ...LEGACY_HEAT_FOLDER_TITLES];
  const run = async() => {
    for(const f of await fs.getDialogFilters(true) as any[]) {
      if(f._ === 'dialogFilter' && f.id > 1 && titles.includes(f.title?.text)) await fs.updateDialogFilter(f, true);
    }
  };
  if(navigator.locks) await navigator.locks.request('nykiss-heat-folders-v3', run); else await run();
  await refreshHeat();
  await reconcileHeatFolders();
  return nykissDebug();
}

// --- visibility / peer-change poll ---
let syncTick = 0;
function sync() {
  syncTick++;
  const visible = !!getActiveInput();
  rootEl.classList.toggle('is-visible', visible);
  if(!visible) { closeMenu(); currentPeerId = null; setChip(''); return; }

  const peerId = (appImManager.chat?.peerId as any) ?? null;
  if(peerId !== currentPeerId) {
    currentPeerId = peerId;
    setChip('');
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
  menuEl.setAttribute('role', 'dialog');
  menuEl.setAttribute('aria-label', 'NYKISS CRM');

  fabEl = document.createElement('button');
  fabEl.className = 'nykiss-qb__fab';
  fabEl.setAttribute('aria-label', 'NYKISS CRM');
  fabEl.setAttribute('aria-expanded', 'false');
  fabEl.innerHTML = '<span class="nykiss-qb__fab-n">N</span>' +
    `<span class="nykiss-qb__badge" aria-hidden="true">${ic('cold', 'i-cold')}${ic('warm', 'i-warm')}${ic('hot', 'i-hot')}</span>`;
  fabEl.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });

  rootEl.append(chipEl, menuEl, fabEl);
  document.body.append(rootEl);

  document.addEventListener('click', (e) => { if(!rootEl.contains(e.target as Node)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeMenu(); });

  (window as any).nykissDebug = nykissDebug;
  (window as any).nykissRepair = nykissRepair;
  console.info('[nykiss] build', BUILD);

  sync();
  watchAvatars();
  window.setTimeout(async() => { await migrateLegacyHeat(); refreshHeat(); }, 4000);
  window.setInterval(refreshHeat, 20000);
  window.setInterval(sync, 600);
}
