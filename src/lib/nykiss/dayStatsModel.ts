// NYKISS: pure rules for "is this incoming message the start of a NEW private dialog today". No Telegram or DOM
// imports, so it can be tested on its own. The caller still checks that the sender is not a bot and that there is
// nothing older in the chat (those need the worker's API).

export const TELEGRAM_SERVICE_ID = 777000;

/** Unix seconds of 00:00 Moscow time for a day key like «2026-10-22». */
export function mskDayStartSec(day: string): number {
  return Date.parse(`${day}T00:00:00+03:00`) / 1000;
}

export type CandidateInput = {
  peerId: number,
  myId: number,
  out: boolean,
  date: number,       // message date, unix seconds
  dayStart: number,   // start of the current Moscow day, unix seconds
  known: ReadonlySet<number>
};

export function isNewDialogCandidate(o: CandidateInput): boolean {
  if(!(o.peerId > 0) || o.peerId === o.myId || o.peerId === TELEGRAM_SERVICE_ID) return false;
  if(o.out || o.known.has(o.peerId)) return false;
  // a message from before today is replayed history, not a dialog that started today
  return o.date >= o.dayStart;
}

// ---- catch-up (scan of dialogs after the tab was closed) ----

/** Server accepts only today and yesterday (MSK): `day must be today or yesterday`. */
export const CATCHUP_DAYS_BACK = 1;
export const CATCHUP_OVERLAP_SEC = 3600;

/** Start of the scan window, unix seconds: yesterday 00:00 MSK, or last successful scan minus an hour, whichever is later. */
export function catchUpSince(todayKey: string, lastSyncSec: number): number {
  const yesterdayStart = mskDayStartSec(todayKey) - 86400 * CATCHUP_DAYS_BACK;
  return Math.max(yesterdayStart, lastSyncSec - CATCHUP_OVERLAP_SEC);
}

/** «2026-10-22» for a unix-seconds date, MSK (+03:00, no DST). */
export function mskDayOfSec(sec: number): string {
  return new Date((sec + 3 * 3600) * 1000).toISOString().slice(0, 10);
}

/** Dialog ordering index is `date * 0x10000 + n`; pinned dialogs carry a fake high index and must not stop the scan. */
export function dialogDateFromIndex(index: number): number {
  return Math.floor(index / 0x10000);
}
