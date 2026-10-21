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
