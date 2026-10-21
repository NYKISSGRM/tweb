// NYKISS: how many NEW private dialogs started today in this worker's Telegram account (a person writing to the worker
// for the first time). Counted from live incoming messages, deduped per person per Moscow day, and reported to the CRM,
// which shows it in the admin («Новых диалогов за день»). Nothing but a number leaves the browser: no names, no text.
import rootScope from '@lib/rootScope';
import {mskDayKey} from '@lib/nykiss/profileModel';
import {apiFetch, getKey} from '@lib/nykiss/quickBubble';

type Rec = {c: number, p: number[], s: number}; // count, counted people, last sent count

const TELEGRAM_SERVICE_ID = 777000;
const SEND_DELAY_MS = 60_000;
const FRESH_SEC = 120; // an older message is history replayed after a reconnect, not a new dialog

const known = new Set<number>();
let rec: Rec | undefined;
let recKey = '';
let timer = 0;

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

  return rec ||= {c: 0, p: [], s: -1};
}

function save() {
  try {
    for(let i = localStorage.length - 1; i >= 0; i--) {
      const name = localStorage.key(i) || '';
      if(name.startsWith('nk_nd_') && name !== recKey) localStorage.removeItem(name);
    }

    localStorage.setItem(recKey, JSON.stringify(rec));
  } catch{}
}

async function flush() {
  timer = 0;
  const r = load();
  if(r.c === r.s || !getKey() || !navigator.onLine) return;
  const day = mskDayKey();
  try {
    await apiFetch('/messenger/stats/new-dialogs', {method: 'POST', body: JSON.stringify({day, count: r.c})});
    if(day === mskDayKey()) {
      r.s = r.c;
      save();
    }
  } catch{} // offline / bad key: sent again on the next change, when the tab is hidden or the network is back
}

const schedule = () => {
  if(!timer) timer = window.setTimeout(flush, SEND_DELAY_MS);
};

async function onMessage(message: any) {
  if(message?._ !== 'message' || message.pFlags?.out) return;
  const peerId = +message.peerId;
  if(!(peerId > 0) || peerId === +rootScope.myId || peerId === TELEGRAM_SERVICE_ID) return;
  if(known.has(peerId)) return;
  known.add(peerId);
  if(Date.now() / 1000 - message.date > FRESH_SEC) return;

  try {
    const {appUsersManager, appMessagesManager} = rootScope.managers;
    if(await appUsersManager.isBot(peerId)) return;
    // new dialog = nothing older than this message in the chat
    const older: any = await appMessagesManager.getHistory({peerId, offsetId: message.mid, limit: 1} as any);
    if(older?.history?.length) return;
  } catch{
    return;
  }

  const r = load();
  if(r.p.includes(peerId)) return;
  r.p.push(peerId);
  r.c++;
  save();
  schedule();
}

export function initDayStats() {
  // people the worker already talks to are never "new", whatever arrives from them today
  rootScope.addEventListener('dialogs_multiupdate', (dialogs) => {
    dialogs.forEach((_, peerId) => known.add(+peerId));
  });
  rootScope.addEventListener('history_multiappend', onMessage);
  document.addEventListener('visibilitychange', () => document.hidden && flush());
  window.addEventListener('online', flush);
}
