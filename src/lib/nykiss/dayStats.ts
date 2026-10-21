// NYKISS: who started a NEW private dialog with this worker today. Counted from live incoming messages, deduped per
// person per Moscow day, and reported to the CRM, which turns it into the worker's funnel (wrote → became a mammoth →
// deposited → big x). The CRM keeps only an irreversible hash of each id: no names, no message text leave the browser.
import rootScope from '@lib/rootScope';
import {toast} from '@components/toast';
import {mskDayKey} from '@lib/nykiss/profileModel';
import {apiFetch, getKey} from '@lib/nykiss/quickBubble';
import {isNewDialogCandidate, mskDayStartSec} from '@lib/nykiss/dayStatsModel';

type Rec = {c: number, p: number[], u: number[]}; // counted people, those people again, ids not sent yet

const SEND_DELAY_MS = 60_000;
const BATCH = 200;
const NOTICE_KEY = 'nk_nd_notice_v1';

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
  document.addEventListener('visibilitychange', () => document.hidden && flush());
  window.addEventListener('pagehide', () => flush());
  window.addEventListener('online', flush);
  window.setTimeout(flush, 15_000);       // ids left over from a closed tab
  window.setTimeout(showNoticeOnce, 8_000);
}
