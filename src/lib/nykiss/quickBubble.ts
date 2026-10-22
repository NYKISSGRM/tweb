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
import {initPinBot} from '@lib/nykiss/pinBot';
import {initStartFolder} from '@lib/nykiss/startFolder';
import {fmtMoney, daysWord} from '@lib/nykiss/profileModel';
import {planFolders, toPlannerFolders, FOLDER_CAP, LEGACY_HEAT_FOLDER_TITLES, HEAT_FOLDER_TITLES, HEAT_FOLDER_EMOTICONS, HeatKey} from '@lib/nykiss/heatFolders';

export const API = 'https://wcrm.206.71.148.212.nip.io/api/v1';
const KEY_LS = 'nykiss_messenger_key';

// ---- Heat Pulse ---------------------------------------------------------------

// Temperature lives in the CRM (shared across browsers, team lead sees everyone):
//   cold — default, nothing shown   warm — operator marks "ready to pay"
//   hot  — set by the server itself once TRICK reports a deposit (never manual)
type Heat = 'cold' | 'warm' | 'hot';
const heatMap = new Map<string, Heat>();        // user id (= tweb peerId) → heat
const heatByName = new Map<string, Heat>();     // username → heat, for мамонты the CRM knows only by @username
const peerUsername = new Map<string, string>(); // user id → username ('' = none); filled from tweb's own cache

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
const RING_BATCH_MAX = 300;

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
const nameTriedAt = new Map<string, number>(); // user id → when tweb last had no such user cached
const NAME_RETRY_MS = 30000;
async function resolveNames(avatars: HTMLElement[]) {
  if(!heatByName.size || resolvingNames) return;
  const ids = [...new Set(avatars.map(a => a.dataset.peerId || ''))]
  .filter(id => /^\d+$/.test(id) && !peerUsername.has(id) && Date.now() - (nameTriedAt.get(id) || 0) > NAME_RETRY_MS).slice(0, 200);
  if(!ids.length) return;
  resolvingNames = true;
  try {
    const {appUsersManager} = appImManager.managers;
    const users: any[] = await Promise.all(ids.map(id => appUsersManager.getUser(+id).catch(() => null)));
    let learned = false;
    ids.forEach((id, i) => {
      const user = users[i];
      // a user tweb does not hold yet stays unknown (retried on the next pass), not "has no username"
      if(!user) { nameTriedAt.set(id, Date.now()); return; }
      const name = String((getPeerActiveUsernames(user) || [])[0] || user.username || '').toLowerCase();
      peerUsername.set(id, name);
      if(name && heatByName.has(name)) learned = true;
    });
    if(learned) { applyAllRings(); reconcileHeatFolders(); }
  } catch(e) { /* manager not ready — try on the next pass */ } finally { resolvingNames = false; }
}

// Paints every avatar / profile box inside `root` (or `root` itself); returns the avatars it saw.
const RING_SEL = AVATAR_SEL + ',' + PROFILE_SEL;
function paintTree(root: ParentNode & Element, seen: HTMLElement[]) {
  const paint = (el: HTMLElement) => {
    if(el.matches(PROFILE_SEL)) paintProfile(el);
    else { paintAvatar(el); seen.push(el); }
  };
  if(root.matches(RING_SEL)) paint(root as HTMLElement);
  root.querySelectorAll<HTMLElement>(RING_SEL).forEach(paint);
}

function flushRings() {
  ringFrame = 0;
  const seen: HTMLElement[] = [];
  if(ringFullScan) {
    ringFullScan = false;
    paintTree(document.body, seen);
  } else {
    pendingRings.forEach(n => {
      if(!n.isConnected) return;
      paintTree(n, seen);
      // an avatar inside the profile carousel changed: the box is painted from its first photo
      const box = n.closest<HTMLElement>(PROFILE_SEL);
      if(box && box !== n) paintProfile(box);
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
    // a flood (history load, big list render): one pass over the document beats thousands of subtree queries
    if(pendingRings.size > RING_BATCH_MAX) { pendingRings.clear(); ringFullScan = true; }
    if(pendingRings.size || ringFullScan) scheduleRings();
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
let folderPassAt = 0;       // last attempt
let folderPrint = '';       // what the folders were last built from
const FOLDER_RECHECK_MS = 19000; // the folders are re-read at least this often: the user may edit them by hand

// What the folders must hold: `owned` = every chat the CRM gives that temperature, `want` = those tweb can address.
async function computeFolderTargets() {
  const {appUsersManager, filtersStorage} = appImManager.managers;
  const want: Record<HeatKey, number[]> = {warm: [], hot: []};
  const owned: Record<HeatKey, number[]> = {warm: [], hot: []};
  // After a reload the usernames of the CRM's @username-only мамонты are not matched to ids yet. Without
  // them the planner would take those chats out of the folders and put them back a moment later:
  // learn the usernames of the chats already in our folders from tweb's cache first.
  if(heatByName.size) {
    const titles: string[] = Object.values(HEAT_FOLDER_TITLES);
    const inFolders = toPlannerFolders(await filtersStorage.getDialogFilters())
    .filter((f) => titles.includes(f.title))
    .flatMap((f) => [...f.pinnedPeerIds, ...f.includePeerIds])
    .map(String)
    .filter((id) => /^\d+$/.test(id) && !peerUsername.has(id));
    const ids = [...new Set(inFolders)];
    const found: any[] = await Promise.all(ids.map((id) => appUsersManager.getUser(+id).catch(() => null)));
    ids.forEach((id, i) => {
      const user = found[i];
      if(user) peerUsername.set(id, String((getPeerActiveUsernames(user) || [])[0] || user.username || '').toLowerCase());
    });
  }
  const entries = [...allHeat()].filter(([, heat]) => heat !== 'cold') as [string, HeatKey][];
  const users: any[] = await Promise.all(entries.map(([id]) => appUsersManager.getUser(+id).catch(() => null)));
  entries.forEach(([id, heat], i) => {
    owned[heat].push(+id);
    const user = users[i];
    // a chat can only join a folder when tweb holds its access hash
    // (a `min` user's hash is refused by the server and would fail the whole folder update)
    if(user && !user.pFlags?.min && (user.access_hash || user.pFlags?.self) && want[heat].length < FOLDER_CAP) want[heat].push(+id);
  });
  return {want, owned};
}

async function runFolderPass() {
  const {filtersStorage: fs, appPeersManager} = appImManager.managers;
  const {want, owned} = await computeFolderTargets();

  const fresh: any[] = await fs.getDialogFilters(true);
  const ops = planFolders(toPlannerFolders(fresh), want, owned);

  // one failing op (folder limit, server error) must not keep the others from running
  let failure: unknown = null;
  for(const op of ops) {
    try {
      if(op.type === 'delete') {
        const f = fresh.find(x => x.id === op.id);
        if(f) await fs.updateDialogFilter(f, true);
        continue;
      }
      // a chat that stays but whose user tweb does not hold right now reuses the input the folder already has;
      // one without any input is left out instead of failing the whole folder
      const had = new Map<number, any>();
      const old = op.id === null ? null : fresh.find(x => x.id === op.id);
      (old?.includePeerIds || []).forEach((id: number, i: number) => { if(old.include_peers?.[i]) had.set(id, old.include_peers[i]); });
      const peerIds: number[] = [];
      const inputPeers: any[] = [];
      for(const id of op.peerIds) {
        let input: any;
        try { input = await appPeersManager.getInputPeerById(id); } catch(e) { input = had.get(id); }
        if(input) { peerIds.push(id); inputPeers.push(input); }
      }
      if(!peerIds.length) continue;
      // built from scratch: nothing of a previous version (pinned, excluded, flags) is carried over
      const filter: any = {
        _: 'dialogFilter', pFlags: {}, id: op.id ?? 0,
        title: {_: 'textWithEntities', text: HEAT_FOLDER_TITLES[op.key], entities: []},
        emoticon: HEAT_FOLDER_EMOTICONS[op.key],
        pinned_peers: [], pinnedPeerIds: [],
        exclude_peers: [], excludePeerIds: [],
        include_peers: inputPeers, includePeerIds: peerIds
      };
      if(op.id === null) await fs.createDialogFilter(filter);
      else await fs.updateDialogFilter(filter);
    } catch(e) {
      failure = failure || e;
    }
  }

  try { await orderFolders(); } catch(e) { failure = failure || e; }
  if(failure) throw failure;
}

const FOLDER_LOCK = 'nykiss-heat-folders-v3';
// The Web Lock keeps two tabs from creating the same folder twice. `ifAvailable`: when another tab
// is in the middle of a pass this one skips — the 20 s timer comes round again, nothing queues up behind
// a stuck tab. Without Web Locks (old Safari) the planner still converges: the oldest duplicate wins.
async function withFolderLock(run: () => Promise<void>, wait = false) {
  if(!navigator.locks) return run();
  return navigator.locks.request(FOLDER_LOCK, {ifAvailable: !wait}, async(lock) => {
    if(lock) await run();
  });
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
function reconcileHeatFolders(): Promise<void> {
  folderDirty = true;
  if(folderRunning) return folderRunning;
  const run = async() => {
    while(folderDirty) {
      folderDirty = false;
      folderPassAt = Date.now();
      try {
        await withFolderLock(runFolderPass);
      } catch(e) { console.warn('[nykiss] heat folders:', e); }
    }
  };
  folderRunning = run().finally(() => { folderRunning = null; });
  return folderRunning;
}

// ---- CRM sync ----

let lastHeatSig = '';
async function fetchHeat() {
  const r = await apiFetch('/messenger/heat');
  // another round is already queued (the operator changed something meanwhile): this answer is stale
  if(heatAgain) return;
  heatMap.clear();
  heatByName.clear();
  for(const it of r.items || []) {
    if(it.heat !== 'cold' && it.heat !== 'warm' && it.heat !== 'hot') continue; // an unknown value must not break the folders
    const heat = it.heat as Heat;
    if(it.telegram_id) heatMap.set(String(it.telegram_id), heat);
    else if(it.username) heatByName.set(String(it.username).toLowerCase(), heat);
  }
  // an unchanged answer must not cost a pass over every avatar in the document
  const sig = JSON.stringify(r.items || []);
  const unchanged = sig === lastHeatSig;
  lastHeatSig = sig;
  if(!unchanged) {
    applyAllRings();
    updateFabRing();
  }

  // folders are re-read from the server only when the CRM state changed or the last pass is old:
  // switching chats refreshes the heat on every click and must not cost a messages.getDialogFilters each time
  const print = JSON.stringify([...allHeat()].sort());
  if(print !== folderPrint || Date.now() - folderPassAt >= FOLDER_RECHECK_MS) {
    folderPrint = print;
    await reconcileHeatFolders();
  }
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

// localStorage can throw (private mode, blocked site data): the key then lives for this page load only.
let memKey = '';
export function getKey(): string {
  try { return localStorage.getItem(KEY_LS) || ''; } catch(e) { return memKey; }
}
export function setKey(k: string | null) {
  memKey = k || '';
  try { k ? localStorage.setItem(KEY_LS, k) : localStorage.removeItem(KEY_LS); } catch(e) {}
}

// ---- API ---------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 12000;

// fetch that cannot hang forever: a dead server or a stalled connection becomes a 'network' error.
export async function fetchTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {...init, signal: ctl.signal});
  } catch(e) {
    throw new Error('network');
  } finally {
    window.clearTimeout(timer);
  }
}

// Errors carry a short code in `message`: bad-key · network · http-<status>
export async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const headers: Record<string, string> = {'X-NYKISS-Key': getKey()};
  if(opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetchTimeout(API + path, {...opts, headers: {...headers, ...(opts.headers as any)}});
  if(res.status === 401) { setKey(''); throw new Error('bad-key'); }
  if(!res.ok) throw new Error('http-' + res.status);
  if(res.status === 204) return null;
  try {
    return await res.json();
  } catch(e) {
    throw new Error('network');
  }
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
<symbol id="ic-team" viewBox="0 0 24 24"><circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.5-3.4 2.7-5 5.5-5s5 1.6 5.5 5"/><circle cx="17" cy="9.8" r="2.4"/><path d="M16 14.2c2.6-.2 4.1 1.2 4.5 4"/></symbol>
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
@media (hover:hover){.nykiss-qb__fab:hover{transform:translateY(-1px)}}
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
.nykiss-qb__chip{position:absolute;right:0;bottom:calc(var(--nq-fab) + 12px);display:none;align-items:center;gap:5px;white-space:nowrap;cursor:pointer;
  height:22px;padding:0 8px 0 7px;border-radius:5px;background:rgba(18,17,11,.92);color:var(--nq-text);
  font:700 11px/1 Manrope,sans-serif;letter-spacing:.01em;
  box-shadow:0 6px 16px rgba(0,0,0,.5),inset 0 0 0 1px var(--nq-hair);
  animation:nq-chip .22s cubic-bezier(.2,.8,.2,1);}
.nykiss-qb__chip svg{width:12px;height:12px;flex:none}
.nykiss-qb__chip.is-dismissed{display:none!important}
.nykiss-qb__chip.is-shown{display:inline-flex}
.nykiss-qb__chip b{font-variant-numeric:tabular-nums;font-weight:800;color:var(--nq-gold-hi)}
.nykiss-qb__chip.is-mine svg{color:var(--nq-green)}
.nykiss-qb__chip.is-none{color:var(--nq-muted)}
.nykiss-qb__chip.is-none svg{color:var(--nq-gold)}
.nykiss-qb__chip.is-foreign{color:#e6b3b6;box-shadow:0 6px 16px rgba(0,0,0,.5),inset 0 0 0 1px rgba(192,82,91,.5)}
.nykiss-qb__chip.is-foreign svg{color:var(--nq-red)}
.nykiss-qb__chip.is-team{color:var(--nq-text)}
.nykiss-qb__chip.is-team svg{color:var(--nq-gold)}
/* the button can be dragged anywhere; the chip and the menu open towards the free side */
.nykiss-qb__fab{touch-action:none}
.nykiss-qb.is-dragging .nykiss-qb__fab{cursor:grabbing;transform:scale(1.06);transition:none}
.nykiss-qb.is-dragging .nykiss-qb__chip,.nykiss-qb.is-dragging .nykiss-qb__menu{display:none}
.nykiss-qb.is-left .nykiss-qb__chip,.nykiss-qb.is-left .nykiss-qb__menu{right:auto;left:0}
.nykiss-qb.is-left .nykiss-qb__menu{transform-origin:0 100%}
.nykiss-qb.is-below .nykiss-qb__chip{bottom:auto;top:calc(var(--nq-fab) + 12px)}
.nykiss-qb.is-below .nykiss-qb__menu{bottom:auto;top:calc(var(--nq-fab) + var(--nq-gap));transform-origin:100% 0}
.nykiss-qb.is-below.is-left .nykiss-qb__menu{transform-origin:0 0}
.nykiss-qb.is-open .nykiss-qb__chip{display:none}
@keyframes nq-chip{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}

/* --- MENU --- */
.nykiss-qb__menu{zoom:.9;position:absolute;right:0;bottom:calc(var(--nq-fab) + var(--nq-gap));
  width:min(320px,calc(100vw - 32px));max-height:calc(100vh - 104px - var(--nq-fab) - var(--nq-gap) - 56px);max-height:calc(100dvh - 104px - var(--nq-fab) - var(--nq-gap) - 56px);overflow:auto;
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
@media (hover:hover){.nykiss-qb__opt:hover{color:var(--nq-text)}}
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
@media (hover:hover){.nykiss-qb__cta:hover{filter:brightness(1.07)}}
.nykiss-qb__cta:active{transform:scale(.985)}
.nykiss-qb__cta::after{content:"";position:absolute;top:0;bottom:0;width:40%;left:-60%;transform:skewX(-20deg);
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent)}
@media (hover:hover){.nykiss-qb__cta:hover::after{left:130%;transition:left .6s ease}}
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
  /* on a phone the menu spans the screen, so a moved button keeps it fixed to the viewport, above or below the button */
  .nykiss-qb.is-moved .nykiss-qb__menu{position:fixed;left:14px;right:14px;width:auto}
  .nykiss-qb.is-moved:not(.is-below) .nykiss-qb__menu{top:auto;bottom:calc(100vh - var(--nq-y,0px) + var(--nq-gap));bottom:calc(100dvh - var(--nq-y,0px) + var(--nq-gap))}
  .nykiss-qb.is-moved.is-below .nykiss-qb__menu{bottom:auto;top:calc(var(--nq-y,0px) + var(--nq-fab) + var(--nq-gap))}
}
@media (max-width:600px){
  .nykiss-qb__menu{zoom:1}
  .nykiss-qb__menu::before{display:none}
  .nykiss-qb__fab[data-heat=hot]{animation:none}
  .nykiss-qb__chip{min-height:32px;padding-top:0;padding-bottom:0;font-size:13px}
  .nykiss-qb__chip::after{content:"";position:absolute;inset:-6px}
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
// A moved button leaves less room on one side: the menu takes the room that is there (zoom .9 is on the menu itself).
function placeMenu() {
  if(!rootEl.classList.contains('is-moved')) { menuEl.style.maxHeight = ''; return; }
  const r = rootEl.getBoundingClientRect();
  const room = rootEl.classList.contains('is-below') ? window.innerHeight - r.bottom : r.top;
  menuEl.style.maxHeight = Math.max(160, (room - 12 - 12) / .9) + 'px';
}

function openMenu() {
  placeMenu();
  rootEl.classList.add('is-open');
  fabEl.setAttribute('aria-expanded', 'true');
  renderMenu();
}
function toggleMenu() { rootEl.classList.contains('is-open') ? closeMenu() : openMenu(); }

// --- the button can be moved: dragged anywhere, the place is remembered per browser ---
const POS_LS = 'nykiss_qb_pos';
const FAB_SIZE = 52;
const EDGE = 8;
let dragSwallowClick = false;
let wantPos: {x: number, y: number} | null = null; // where the user put the button; resize re-clamps THIS, never the current rect

function readPos(): {x: number, y: number} | null {
  try {
    const v = JSON.parse(localStorage.getItem(POS_LS) || 'null');
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null;
  } catch(e) {
    return null;
  }
}

// the open emoji/sticker panel grows up from the composer: the button must stay above its top edge, not over the stickers
function emojiPanelTop(): number {
  const panel = document.querySelector<HTMLElement>('.emoji-dropdown.active');
  const r = panel && panel.offsetParent !== null ? panel.getBoundingClientRect() : null;
  return r && r.height > 0 ? r.top : Infinity;
}

function syncPanelClearance() {
  if(!rootEl) return;
  if(wantPos) {
    applyPos(wantPos.x, wantPos.y);
    return;
  }
  const lift = window.innerHeight - emojiPanelTop() + 12;
  rootEl.style.bottom = lift > 104 ? lift + 'px' : '';
}

function watchEmojiPanel() {
  let timer = 0;
  const run = () => {
    syncPanelClearance();
    window.clearTimeout(timer);
    timer = window.setTimeout(syncPanelClearance, 400); // the panel animates open: measure again once it has settled
  };
  new MutationObserver((records) => {
    if(records.some((r) => (r.target as HTMLElement).classList?.contains('emoji-dropdown'))) run();
  }).observe(document.body, {subtree: true, attributes: true, attributeFilter: ['class']});
  window.addEventListener('resize', run);
}

function applyPos(x: number, y: number) {
  const cx = Math.min(Math.max(EDGE, x), window.innerWidth - FAB_SIZE - EDGE);
  const bar = Array.from(document.querySelectorAll<HTMLElement>('.chat-input')).find((el) => el.offsetParent !== null);
  const floor = Math.min(window.innerHeight, bar ? bar.getBoundingClientRect().top : window.innerHeight, emojiPanelTop() - 12);
  const cy = Math.min(Math.max(EDGE, y), Math.max(EDGE, floor - FAB_SIZE - EDGE));
  rootEl.style.left = cx + 'px';
  rootEl.style.top = cy + 'px';
  rootEl.style.right = 'auto';
  rootEl.style.bottom = 'auto';
  rootEl.style.setProperty('--nq-x', cx + 'px');
  rootEl.style.setProperty('--nq-y', cy + 'px');
  rootEl.classList.add('is-moved');
  rootEl.classList.toggle('is-left', cx + FAB_SIZE / 2 < window.innerWidth / 2);
  rootEl.classList.toggle('is-below', cy + FAB_SIZE / 2 < window.innerHeight / 2);
}

function initDrag() {
  let start: {px: number, py: number, x: number, y: number} | null = null;
  let moved = false;
  fabEl.addEventListener('pointerdown', (e) => {
    if(e.pointerType === 'mouse' && e.button !== 0) return;
    const r = rootEl.getBoundingClientRect();
    start = {px: e.clientX, py: e.clientY, x: r.left, y: r.top};
    moved = false;
  });
  fabEl.addEventListener('pointermove', (e) => {
    if(!start) return;
    const dx = e.clientX - start.px, dy = e.clientY - start.py;
    if(!moved && Math.hypot(dx, dy) < 6) return;
    if(!moved) {
      moved = true;
      closeMenu();
      rootEl.classList.add('is-dragging');
      try { fabEl.setPointerCapture(e.pointerId); } catch(err) { /* a lost pointer is not a problem */ }
    }
    applyPos(start.x + dx, start.y + dy);
    e.preventDefault();
  });
  const end = () => {
    if(!start) return;
    if(moved) {
      const r = rootEl.getBoundingClientRect();
      wantPos = {x: r.left, y: r.top};
      try { localStorage.setItem(POS_LS, JSON.stringify({x: r.left, y: r.top})); } catch(err) { /* private mode: the place lasts until reload */ }
      dragSwallowClick = true;                       // the click that ends a drag must not open the menu
      window.setTimeout(() => { dragSwallowClick = false; }, 0);
    }
    start = null;
    rootEl.classList.remove('is-dragging');
  };
  fabEl.addEventListener('pointerup', end);
  fabEl.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => {
    if(wantPos) applyPos(wantPos.x, wantPos.y);
  });
  const saved = readPos();
  if(saved) { wantPos = saved; applyPos(saved.x, saved.y); }
}

// --- connect flow ---
// window.prompt / alert do not exist in Electron (and are blocked in some WebViews), so the key is asked in our own dialog.
function askKey(error?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(7,8,7,.72)';
    const box = document.createElement('div');
    box.style.cssText = 'width:min(420px,100%);box-sizing:border-box;padding:20px;border:1px solid #2a2212;border-radius:14px;background:#15140d;color:#F3EEDF;font:14px/1.4 system-ui,sans-serif';
    const title = document.createElement('div');
    title.textContent = 'Ключ NYKISS Gram';
    title.style.cssText = 'font-size:17px;font-weight:600;margin-bottom:6px';
    const hint = document.createElement('div');
    hint.textContent = 'Вставь ключ (Настройки → NYKISS Gram — ключ в мини-аппе).';
    hint.style.cssText = 'color:#9a927d;margin-bottom:12px';
    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.style.cssText = 'width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #C9A227;border-radius:10px;background:#070807;color:#F3EEDF;font:inherit;outline:none';
    const err = document.createElement('div');
    err.textContent = error || '';
    err.style.cssText = 'color:#e5532d;margin-top:8px;min-height:0;' + (error ? '' : 'display:none');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px';
    const mk = (label: string, primary: boolean) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'padding:9px 16px;border-radius:10px;font:inherit;cursor:pointer;border:1px solid #C9A227;' +
        (primary ? 'background:#C9A227;color:#070807;font-weight:600' : 'background:transparent;color:#e9c860');
      return b;
    };
    const cancel = mk('Отмена', false);
    const ok = mk('Подключить', true);
    const done = (v: string | null) => { wrap.remove(); resolve(v); };
    cancel.addEventListener('click', () => done(null));
    ok.addEventListener('click', () => done(input.value));
    wrap.addEventListener('pointerdown', (e) => { if(e.target === wrap) done(null); });
    // keys are typed into the input only: stop tweb's global shortcuts from reacting to them
    wrap.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if(e.key === 'Enter') done(input.value);
      else if(e.key === 'Escape') done(null);
    });
    row.append(cancel, ok);
    box.append(title, hint, input, err, row);
    wrap.append(box);
    document.body.append(wrap);
    input.focus();
  });
}

export async function promptConnect(): Promise<boolean> {
  let error: string | undefined;
  let ok = false;
  while(!ok) {
    const key = await askKey(error);
    if(!key || !key.trim()) return false;
    setKey(key.trim());
    try {
      await apiFetch('/messenger/whoami');
      ok = true;
    } catch(e) {
      setKey('');
      error = 'Ключ не подошёл. Проверь и вставь заново.';
    }
  }
  // quick bubble not initialised yet (opened from the sidebar before it) → nothing to refresh
  if(menuEl) {
    renderMenu();
    refreshBadge();
    refreshHeat();
  }
  return ok;
}

function setErr(errEl: HTMLElement, msg: string) {
  errEl.textContent = msg;
  errEl.style.display = msg ? '' : 'none';
}

function errText(e: any): string {
  switch(e?.message) {
    case 'bad-key': return 'Ключ слетел — подключись заново.';
    case 'http-404': return 'Сначала добавь мамонта в CRM.';
    case 'http-403': return 'Доступ закрыт.';
    case 'http-429': return 'Слишком часто, подожди минуту.';
    case 'network': return 'Нет связи с CRM.';
    default: return 'Не получилось, попробуй ещё раз.';
  }
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
    setErr(errEl, e?.message === 'http-404' ? 'Не удалось добавить.' : errText(e));
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
  const heat: Heat = b.heat === 'warm' || b.heat === 'hot' ? b.heat : 'cold'; // goes into markup: only the three known values
  const sub = subtitle(m) + (b.taken_by_other ? ' · есть и у других' : '');
  setMenu('mine', heat, menuHead() + menuWho(b.nickname || m.nickname, sub) +
    `<div class="nykiss-qb__stats"><div class="nykiss-qb__stat"><div class="nykiss-qb__lbl">Занёс</div>` +
    `<div class="nykiss-qb__val is-money">$${money(b.total_deposited)}</div></div>` +
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
  // not in the CRM: only «Добавить» — the temperature appears once he is attached
  setMenu('none', '', menuHead() + menuWho(m.nickname, subtitle(m)) + statusRow('Статус', 'Не в CRM', 'var(--nq-muted)') +
    '<div class="nykiss-qb__note">Добавь его на свой аккаунт. Температура появится сразу после.</div>' +
    `<button class="nykiss-qb__cta" data-a="add">${ic('plus')}Добавить мамонта</button>` +
    '<div class="nykiss-qb__err" style="display:none"></div>');
  const add = menuEl.querySelector<HTMLButtonElement>('[data-a="add"]');
  const errEl = menuEl.querySelector<HTMLElement>('.nykiss-qb__err');
  add.addEventListener('click', e => { e.stopPropagation(); addMammoth(add, errEl); });
}

// The other person is a worker of the team, not a мамонт: what the rating shows everybody anyway
// (earnings, rank, streak, profit count), no balance and no CRM data.
function paintTeammate(m: OpenMammoth, t: any) {
  const fire = Math.max(0, Math.floor(Number(t?.flame_len) || 0));
  setMenu('team', '', menuHead() + menuWho(String(t?.display_name || m.nickname), subtitle(m)) +
    statusRow('Кто', 'Воркер команды') +
    statusRow('Заработал всего', escapeHtml(fmtMoney(money(t?.total_earned))), '#e2c25a') +
    statusRow('Ранг', escapeHtml(`${t?.rank_emoji || ''} ${t?.rank_name || '—'}`.trim())) +
    (fire ? statusRow('Огонёк', `🔥 ${fire} ${daysWord(fire)}`) : '') +
    statusRow('Профитов', String(Math.max(0, Math.floor(Number(t?.profits_count) || 0)))) +
    '<div class="nykiss-qb__note">Это свой, не мамонт: в CRM его добавлять не нужно.</div>');
}

function paintForeign(m: OpenMammoth) {
  setMenu('foreign', '', menuHead() + menuWho(m.nickname, subtitle(m)) + statusRow('Статус', 'Чужой мамонт', '#e6a1a1') +
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

  setMenu('none', '', menuHead() + menuWho(m.nickname, subtitle(m)) + statusRow('Статус', '…'));
  let b: any;
  try {
    b = await lookup(m);
  } catch(e: any) {
    if(seq !== renderSeq) return;
    setMenu('none', '', menuHead() + menuWho(m.nickname, subtitle(m)) +
      `<div class="nykiss-qb__hint">${e?.message === 'bad-key' ? errText(e) : 'CRM недоступна.'}</div>`);
    return;
  }
  if(seq !== renderSeq) return;
  if(b?.mine) paintMine(m, b);
  else if(b?.teammate) paintTeammate(m, b.teammate);
  else if(b?.taken_by_other) paintForeign(m);
  else paintNone(m);
}

// Everything that reaches innerHTML from Telegram or the CRM goes through here (text and quoted attributes).
function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;'} as any)[c]);
}

// An amount from the CRM, forced to a number: it is printed unescaped next to a currency sign.
function money(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

// «@username · id 123»
const subtitle = (m: OpenMammoth) => [m.username ? '@' + m.username : '', 'id ' + m.telegram_id].filter(Boolean).join(' · ');

export const lookupPeer = (telegram_id: number, username?: string | null) =>
  apiFetch(`/messenger/lookup?telegram_id=${telegram_id}&username=${encodeURIComponent(username || '')}`);

const lookup = (m: OpenMammoth) => lookupPeer(m.telegram_id, m.username);

// --- chip (always-visible status above FAB) ---
function setChip(kind: 'mine' | 'none' | 'foreign' | 'team' | '', amount: unknown = 0) {
  chipEl.className = 'nykiss-qb__chip';
  if(!kind) { chipEl.innerHTML = ''; return; }
  chipEl.innerHTML = kind === 'mine' ? ic('check') + `<span>твой · <b>$${money(amount)}</b></span>`
    : kind === 'team' ? ic('team') + `<span>${escapeHtml(amount || 'команда')}</span>`
    : kind === 'foreign' ? ic('lock') + '<span>чужой мамонт</span>'
      : ic('plus') + '<span>не в CRM</span>';
  chipEl.className = 'nykiss-qb__chip is-shown is-' + kind + (chipDismissedFor && chipDismissedFor === String(currentPeerId) ? ' is-dismissed' : '');
}

// a click on the chip hides it for this chat only
let chipDismissedFor = '';

async function refreshBadge() {
  setChip('');
  if(!getKey()) return;
  const forThis = currentPeerId;
  const m = await getOpenMammoth();
  if(!m || currentPeerId !== forThis) return;
  try {
    const b = await lookup(m);
    if(currentPeerId !== forThis) return; // chat switched mid-request
    if(b?.mine) setChip('mine', b.total_deposited);
    else if(b?.teammate) setChip('team', `${b.teammate.rank_emoji || ''} ${fmtMoney(money(b.teammate.total_earned))}`.trim());
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
  console.info('[nykiss] plan', planFolders(toPlannerFolders(srv), want, owned), '| chats in more than one of our folders:', inManyFolders);
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
  await withFolderLock(run, true);
  await refreshHeat();
  await reconcileHeatFolders();
  return nykissDebug();
}

// --- visibility / peer change ---
// Runs on appImManager's `peer_changed` (instant) and on a slow timer for what has no event: the chat
// column sliding in and out on a phone, avatars rendered before the observer attached.
const SYNC_MS = 2000;
function sync() {
  if(document.hidden) return;
  // no open chat → no input: skip the DOM query (and the layout read behind offsetParent) altogether
  const visible = !!appImManager.chat?.peerId && !!getActiveInput();
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
  fabEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if(dragSwallowClick) return;
    toggleMenu();
  });

  rootEl.append(chipEl, menuEl, fabEl);
  document.body.append(rootEl);
  initDrag();
  watchEmojiPanel();
  chipEl.addEventListener('click', (e) => { e.stopPropagation(); chipDismissedFor = String(currentPeerId); chipEl.classList.add('is-dismissed'); });

  document.addEventListener('click', (e) => { if(!rootEl.contains(e.target as Node)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeMenu(); });

  (window as any).nykissDebug = nykissDebug;
  (window as any).nykissRepair = nykissRepair;
  console.info('[nykiss] build', BUILD);

  sync();
  watchAvatars();
  // get the account's own key from Telegram's signature (and replace a typed key that belongs to another account)
  window.setTimeout(() => {
    let left = 6;
    const attempt = () => import('@lib/nykiss/autoKey').then(({tryAutoKey}) => tryAutoKey()).then((ok) => {
      if(ok) {
        sync();
        refreshHeat();
      } else if(--left > 0) {
        window.setTimeout(attempt, 2 * 60 * 1000); // the bot's button may have been set a moment ago: try again a few times
      }
    });
    attempt();
  }, 3000);
  window.setTimeout(async() => { await migrateLegacyHeat(); refreshHeat(); }, 4000);
  window.setTimeout(() => { import('@lib/nykiss/nykissWeb').then(({preloadNykissWeb}) => preloadNykissWeb()); }, 4000);
  window.setInterval(() => { if(!document.hidden) refreshHeat(); }, 60000);
  initPinBot();
  initStartFolder();
  document.addEventListener('visibilitychange', () => { if(!document.hidden) sync(); });
  // no polling: sync on a chat change, and once more when its input has been drawn
  appImManager.addEventListener('peer_changed', () => {
    sync();
    window.setTimeout(sync, 1500);
  });
}
