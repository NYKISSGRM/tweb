// NYKISS: who started a NEW private dialog with this worker today. Counted from live incoming messages, deduped per
// person per Moscow day, and reported to the CRM, which turns it into the worker's funnel (wrote → became a mammoth →
// deposited → big x). The CRM keeps only an irreversible hash of each id: no names, no message text leave the browser.
import rootScope from '@lib/rootScope';
import {toast} from '@components/toast';
import {mskDayKey} from '@lib/nykiss/profileModel';
import {apiFetch, getKey} from '@lib/nykiss/quickBubble';
import {isNewDialogCandidate, mskDayStartSec, catchUpSince, mskDayOfSec, dialogDateFromIndex} from '@lib/nykiss/dayStatsModel';

type Rec = {c: number, p: number[], u: number[]}; // counted people, those people again, ids not sent yet

const SEND_DELAY_MS = 60_000;
const BATCH = 200;
const NOTICE_KEY = 'nk_nd_notice_v1';
const SYNC_MIN_GAP_MS = 10 * 60_000;   // scan at most once per 10 min
const SCAN_PAGE = 100;
const SCAN_MAX_DIALOGS = 600;          // ceiling for one scan
const SCAN_MAX_CHECKS = 150;           // ceiling of per-chat history checks per scan
const SCAN_PAUSE_MS = 120;
const HISTORY_PAGE = 40;
const HISTORY_PAGES_MAX = 4;

const known = new Set<number>();
let rec: Rec | undefined;
let recKey = '';
let timer = 0;
let sending = false;

const lsKey = () => `nk_nd_${rootScope.myId}_${mskDayKey()}`;

function load(): Rec {
  const key = lsKey();
  if(rec && key === recKey) return rec;
  recKey = key;
  try {
    rec = JSON.parse(localStorage.getItem(key) || '');
  } catch{
    rec = undefined;
  }

  rec ||= {c: 0, p: [], u: []};
  rec.u ||= []; // records written by the older counter had no list of unsent ids
  return rec;
}

function save() {
  try {
    for(let i = localStorage.length - 1; i >= 0; i--) {
      const name = localStorage.key(i) || '';
      if(name.startsWith('nk_nd_') && name !== recKey && /^nk_nd_\d+_\d{4}-/.test(name)) localStorage.removeItem(name);
    }

    localStorage.setItem(recKey, JSON.stringify(rec));
  } catch{}
}

async function flush() {
  timer = 0;
  if(sending || !getKey() || !navigator.onLine) return;
  const r = load();
  if(!r.u.length) return;
  const day = mskDayKey();
  sending = true;
  try {
    while(r.u.length && day === mskDayKey()) {
      const ids = r.u.slice(0, BATCH);
      await apiFetch('/messenger/stats/new-dialog-people', {method: 'POST', body: JSON.stringify({day, ids})});
      r.u.splice(0, ids.length);
      save();
    }
  } catch{} // offline / bad key / server busy: the ids stay in the list and go out on the next change or tab hide
  sending = false;
  if(r.u.length) schedule();
}

const schedule = () => {
  if(!timer) timer = window.setTimeout(flush, SEND_DELAY_MS);
};

async function onMessage(message: any) {
  if(message?._ !== 'message') return;
  const peerId = +message.peerId;
  if(!isNewDialogCandidate({
    peerId, myId: +rootScope.myId, out: !!message.pFlags?.out, date: message.date,
    dayStart: mskDayStartSec(mskDayKey()), known
  })) return;
  known.add(peerId);

  try {
    const {appUsersManager, appMessagesManager} = rootScope.managers;
    if(await appUsersManager.isBot(peerId)) return;
    // a new dialog = nothing older than this message in the chat
    const older: any = await appMessagesManager.getHistory({peerId, offsetId: message.mid, limit: 1} as any);
    if(older?.history?.length) return;
  } catch{
    known.delete(peerId); // a failed check must not hide the dialog forever: the next message tries again
    return;
  }

  const r = load();
  if(r.p.includes(peerId)) return;
  r.p.push(peerId);
  r.u.push(peerId);
  r.c++;
  save();
  schedule();
}

// ---- catch-up: everything that started while the tab was closed / hidden / on an old build -----------------------------
const syncKey = () => `nk_nd_sync_${rootScope.myId}`;
const sentKey = () => `nk_nd_sent_${rootScope.myId}`;   // {peerId: day}: already reported by a scan, pruned to the window
let scanning = false;

const readSync = (): number => { try { return +(localStorage.getItem(syncKey()) || 0) || 0; } catch{ return 0; } };
const readSent = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(sentKey()) || '{}') || {}; } catch{ return {}; } };

/** Returns the day (MSK) the dialog started on, if it started inside the window with an incoming first message; else undefined. */
async function dialogStartDay(peerId: number, since: number): Promise<string | undefined> {
  const {appMessagesManager, appUsersManager} = rootScope.managers;
  if(await appUsersManager.isBot(peerId)) return;
  let offsetId = 0;
  for(let page = 0; page < HISTORY_PAGES_MAX; page++) {
    const res: any = await appMessagesManager.getHistory({peerId, offsetId, limit: HISTORY_PAGE} as any);
    const mids: number[] = res?.history || [];
    if(!mids.length) return;
    const oldestMid = mids[mids.length - 1];
    const msg: any = await appMessagesManager.getMessageByPeer(peerId, oldestMid);
    if(msg?._ !== 'message') return;
    if(msg.date < since) return;                       // there is something older than the window: not a new dialog
    const atStart = !!res?.isEnd?.top || mids.length < HISTORY_PAGE;
    if(atStart) return msg.pFlags?.out ? undefined : mskDayOfSec(msg.date); // worker wrote first: not "wrote to us"
    offsetId = oldestMid;
  }
  // 160 messages inside the window and still no start: a very old busy chat, not counted (safer than a false "new")
}

export async function catchUp(force = false) {
  if(scanning || !getKey() || !navigator.onLine || !rootScope.myId) return;
  const last = readSync();
  if(!force && Date.now() - last * 1000 < SYNC_MIN_GAP_MS) return;
  scanning = true;
  const startedAt = Math.floor(Date.now() / 1000);
  try {
    const today = mskDayKey();
    const since = catchUpSince(today, last);
    const sent = readSent();
    const found = new Map<string, number[]>();
    let seen = 0, checks = 0, complete = false;
    const {dialogsStorage} = rootScope.managers;

    for(const folderId of [0, 1]) {            // main list, then archive
      let offsetIndex = 0;
      while(seen < SCAN_MAX_DIALOGS) {
        const res: any = await dialogsStorage.getDialogs({filterId: folderId, limit: SCAN_PAGE, offsetIndex, skipMigrated: true} as any);
        const list: any[] = res?.dialogs || [];
        let stop = false;
        for(const d of list) {
          seen++;
          const peerId = +d.peerId;
          const idx = d.index_0 ?? 0;
          offsetIndex = idx || offsetIndex;
          if(!d.pFlags?.pinned && dialogDateFromIndex(idx) < since) { stop = true; break; } // list is ordered by last message
          if(!(peerId > 0) || peerId === +rootScope.myId || peerId === 777000) continue;
          if(r_has(peerId)) continue;
          if(sent[peerId]) continue;
          if(checks++ >= SCAN_MAX_CHECKS) { stop = true; break; }
          try {
            const day = await dialogStartDay(peerId, since);
            if(day) (found.get(day) ?? found.set(day, []).get(day)!).push(peerId);
          } catch{ return; }                 // API trouble: do not move the sync mark, try again later
          await new Promise((ok) => setTimeout(ok, SCAN_PAUSE_MS));
        }
        if(stop || res?.isEnd || !list.length) { complete = stop || !!res?.isEnd || !list.length; break; }
      }
      if(seen >= SCAN_MAX_DIALOGS) break;
    }

    // hand the ids to the normal sender: today's go to the record of the day, yesterday's go straight out
    const r = load();
    for(const [day, ids] of found) {
      const fresh = ids.filter((id) => !r.p.includes(id));
      if(day === today) {
        fresh.forEach((id) => { r.p.push(id); r.u.push(id); r.c++; known.add(id); });
      } else if(fresh.length) {
        try {
          for(let i = 0; i < fresh.length; i += BATCH) await apiFetch('/messenger/stats/new-dialog-people', {method: 'POST', body: JSON.stringify({day, ids: fresh.slice(i, i + BATCH)})});
        } catch{ return; }
      }
      fresh.forEach((id) => { sent[id] = day; });
    }
    for(const id of Object.keys(sent)) if(mskDayStartSec(sent[id]) < since - 86400) delete sent[id];
    save();
    try { localStorage.setItem(sentKey(), JSON.stringify(sent)); } catch{}
    if(r.u.length) schedule();
    if(complete) try { localStorage.setItem(syncKey(), String(startedAt)); } catch{}   // only a full pass moves the mark
  } catch{} finally {
    scanning = false;
  }
}
const r_has = (peerId: number) => load().p.includes(peerId);

/** One short line, once per browser: the workers are told what Gram counts and what it never sends. */
function showNoticeOnce() {
  try {
    if(localStorage.getItem(NOTICE_KEY)) return;
    localStorage.setItem(NOTICE_KEY, '1');
  } catch{
    return;
  }

  toast('NYKISS Gram считает, сколько людей написало вам впервые за день. Имена и текст сообщений никуда не уходят.', undefined, 10_000);
}

export function initDayStats() {
  // people the worker already talks to are never "new", whatever arrives from them today
  rootScope.addEventListener('dialogs_multiupdate', (dialogs) => {
    dialogs.forEach((_, peerId) => known.add(+peerId));
  });
  rootScope.addEventListener('history_multiappend', onMessage);
  document.addEventListener('visibilitychange', () => document.hidden ? flush() : window.setTimeout(catchUp, 3_000));
  window.addEventListener('pagehide', () => flush());
  window.addEventListener('online', () => { flush(); window.setTimeout(catchUp, 3_000); });
  window.setTimeout(flush, 15_000);       // ids left over from a closed tab
  window.setTimeout(catchUp, 25_000);     // dialogs list is loaded by now; picks up what started while the app was closed
  window.setInterval(() => !document.hidden && catchUp(), SYNC_MIN_GAP_MS + 30_000);
  window.setTimeout(showNoticeOnce, 8_000);
}
