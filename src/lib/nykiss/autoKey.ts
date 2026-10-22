// NYKISS: sign in to the CRM without typing the worker key. If the Telegram account that is logged in to Gram belongs
// to a worker in the CRM, Gram asks Telegram for data signed for the CRM bot (the same signature the Mini App uses),
// the CRM checks that signature and hands back the worker's personal key. Nobody can claim another account this way:
// the CRM trusts only what Telegram signed, never an @username or an id sent by the browser.
import rootScope from '@lib/rootScope';
import {API, fetchTimeout, getKey, setKey} from '@lib/nykiss/quickBubble';
import {extractInitData} from '@lib/nykiss/autoKeyModel';

const BOT_USERNAME = 'Nykisshelperbot';
const RETRY_LS = 'nk_autokey_at';
const BOUND_LS = 'nk_key_tg';   // Telegram id of the account the stored key was checked against
const RETRY_MS = 30 * 60 * 1000;   // one attempt per half hour at most: a manual key or a non-worker account is a normal end

async function requestInitData(): Promise<string | undefined> {
  const {appUsersManager, appAttachMenuBotsManager} = rootScope.managers;
  const user: any = await appUsersManager.resolveUserByUsername(BOT_USERNAME);
  if(!user) return;
  const botId = user.id;
  const peerId = botId.toPeerId(false);

  // The bot's main app first, then its menu button: whichever one Telegram allows gives a signed link.
  const attempts: any[] = [
    {botId, peerId, main: true},
    {botId, peerId, fromBotMenu: true, url: 'https://wcrm.206.71.148.212.nip.io/'} // the way Telegram stores the menu button address
  ];
  for(const options of attempts) {
    try {
      const result: any = await appAttachMenuBotsManager.requestWebView(options);
      const data = extractInitData(result?.url || '');
      if(data) return data;
    } catch{} // this way is not allowed for the bot: try the next one
  }
}

function boundTo(): string {
  try { return localStorage.getItem(BOUND_LS) || ''; } catch{ return ''; }
}

function bind(): void {
  try { localStorage.setItem(BOUND_LS, String(rootScope.myId)); } catch{}
}

/** true once the key in this Gram is the one that belongs to the logged-in Telegram account */
export function isKeyBound(): boolean {
  return !!getKey() && boundTo() === String(rootScope.myId);
}

export async function tryAutoKey(): Promise<boolean> {
  // a key typed by hand (or left from another account) is not proof it is this account's: check it against Telegram's signature once
  if(isKeyBound()) return true;
  try {
    const last = +(localStorage.getItem(RETRY_LS) || 0);
    if(Date.now() - last < RETRY_MS) return false;
    localStorage.setItem(RETRY_LS, String(Date.now()));
  } catch{}

  try {
    const initData = await requestInitData();
    if(!initData) {
      // Telegram gave no signed link (for example the bot's button is not set for this chat yet): that is not a final answer, try again in a minute
      try { localStorage.setItem(RETRY_LS, String(Date.now() - RETRY_MS + 60 * 1000)); } catch{}
      return false;
    }
    const res = await fetchTimeout(API + '/messenger/key/by-telegram', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify({init_data: initData})
    });
    if(res.status === 403) { // not a CRM worker: whatever key is stored stays, nothing more to check for this account
      bind();
      return false;
    }
    if(!res.ok) return false; // 401/429: nothing to do now, the manual key stays available
    const body: any = await res.json();
    if(typeof body?.key !== 'string' || !body.key) return false;
    bind();
    if(body.key === getKey()) return true;
    setKey(body.key); // the account's own key replaces a wrong one
    return true;
  } catch{
    return false;
  }
}
