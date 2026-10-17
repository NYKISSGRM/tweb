// src/lib/nykiss/pinBot.ts
// NYKISS Gram — the team bot (@Nykisshelperbot) stays pinned at the very top of the chat list for everybody.
// The pin is a real Telegram pin, so it follows the account to every device. If the user unpins or moves
// it, the next pass puts it back. Nothing is sent and no chat is created: a bot the account has never
// opened has no dialog yet and is picked up on the pass after the first message from it.

import appImManager from '@lib/appImManager';

const BOT_USERNAME = 'Nykisshelperbot';
const MAIN_FOLDER = 0;
const ARCHIVE_FOLDER = 1;
const PASS_MS = 30000;
const FAIL_BACKOFF_MS = 5 * 60000;
const LOCK = 'nykiss-pin-bot-v1';

let busy = false;
let quietUntil = 0;
let botPeerId: PeerId | undefined;
let lastStatus = 'not run yet';

function report(status: string) {
  if(status !== lastStatus) console.info('[nykiss] pin bot:', status);
  lastStatus = status;
}

async function resolveBot(): Promise<PeerId | undefined> {
  if(botPeerId) return botPeerId;
  const user: any = await appImManager.managers.appUsersManager.resolveUserByUsername(BOT_USERNAME);
  if(user) botPeerId = user.id.toPeerId(false);
  return botPeerId;
}

async function pass() {
  if(busy || Date.now() < quietUntil) return;
  busy = true;
  try {
    const peerId = await resolveBot();
    if(!peerId) return report('bot not found by username');

    const {appMessagesManager, dialogsStorage} = appImManager.managers;
    const dialog: any = await appMessagesManager.getDialogOnly(peerId);
    // never opened (no dialog yet) or deliberately archived: leave it alone
    if(!dialog) return report('no dialog with the bot yet (open the chat once)');
    if(dialog.folder_id === ARCHIVE_FOLDER) return report('bot chat is archived, left alone');

    let pins: PeerId[] = await dialogsStorage.getPinnedOrderForFilter(MAIN_FOLDER);
    if(!dialog.pFlags?.pinned || !pins.includes(peerId)) {
      await appMessagesManager.setDialogPin({peerId, pinned: true, folderId: MAIN_FOLDER});
      pins = await dialogsStorage.getPinnedOrderForFilter(MAIN_FOLDER);
    }

    if(pins[0] !== peerId) {
      await appMessagesManager.reorderPinnedDialogs({filterId: MAIN_FOLDER, order: [peerId, ...pins.filter((id) => id !== peerId)]});
      return report('pinned and moved to the top');
    }
    report('pinned first');
  } catch(e) {
    // pin limit reached, flood wait, offline: stay quiet for a while instead of hammering the server
    quietUntil = Date.now() + FAIL_BACKOFF_MS;
    report('failed: ' + ((e as any)?.type || (e as any)?.message || e));
    console.warn('[nykiss] pin bot failed', e);
  } finally {
    busy = false;
  }
}

function run() {
  if(!navigator.locks) return pass();
  return navigator.locks.request(LOCK, {ifAvailable: true}, async(lock) => {
    if(lock) await pass();
  });
}

export function initPinBot() {
  // console: await nykissPinBot() runs a pass now and says what happened
  (window as any).nykissPinBot = async() => {
    quietUntil = 0;
    await pass();
    return lastStatus;
  };
  window.setTimeout(run, 6000);
  window.setInterval(() => { if(!document.hidden) run(); }, PASS_MS);
}
