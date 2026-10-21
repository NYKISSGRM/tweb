// NYKISS: sign in to the CRM without typing the worker key. If the Telegram account that is logged in to Gram belongs
// to a worker in the CRM, Gram asks Telegram for data signed for the CRM bot (the same signature the Mini App uses),
// the CRM checks that signature and hands back the worker's personal key. Nobody can claim another account this way:
// the CRM trusts only what Telegram signed, never an @username or an id sent by the browser.
import rootScope from '@lib/rootScope';
import {API, fetchTimeout, getKey, setKey} from '@lib/nykiss/quickBubble';
import {extractInitData} from '@lib/nykiss/autoKeyModel';

const BOT_USERNAME = 'Nykisshelperbot';
const RETRY_LS = 'nk_autokey_at';
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
    {botId, peerId, fromBotMenu: true, url: 'https://wcrm.206.71.148.212.nip.io'}
  ];
  for(const options of attempts) {
    try {
      const result: any = await appAttachMenuBotsManager.requestWebView(options);
      const data = extractInitData(result?.url || '');
      if(data) return data;
    } catch{} // this way is not allowed for the bot: try the next one
  }
}

export async function tryAutoKey(): Promise<boolean> {
  if(getKey()) return true;
  try {
    const last = +(localStorage.getItem(RETRY_LS) || 0);
    if(Date.now() - last < RETRY_MS) return false;
    localStorage.setItem(RETRY_LS, String(Date.now()));
  } catch{}

  try {
    const initData = await requestInitData();
    if(!initData) return false;
    const res = await fetchTimeout(API + '/messenger/key/by-telegram', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify({init_data: initData})
    });
    if(!res.ok) return false; // 403: not a CRM worker, 401/429: nothing to do, the manual key stays available
    const body: any = await res.json();
    if(typeof body?.key !== 'string' || !body.key) return false;
    setKey(body.key);
    return true;
  } catch{
    return false;
  }
}
