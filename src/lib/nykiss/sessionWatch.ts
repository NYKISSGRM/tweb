// NYKISS: when Telegram ends the worker's session (Gram throws them out to the login screen) the reason is sent to the
// CRM: only the error type and code (for example SESSION_REVOKED, AUTH_KEY_DUPLICATED, AUTH_KEY_UNREGISTERED), so the owner
// can see whether it is Telegram's own protection, a duplicated session or something else. No chats, no ids of others.
import rootScope from '@lib/rootScope';
import {API, getKey} from '@lib/nykiss/quickBubble';

export function initSessionWatch() {
  rootScope.addEventListener('nykiss_session_lost', ({type, code}) => {
    const key = getKey();
    try {
      localStorage.setItem('nk_last_session_lost', JSON.stringify({type, code, at: Date.now()}));
    } catch{}

    if(!key) return;
    try {
      // keepalive: the page is about to leave for the login screen, the request must still go out
      fetch(API + '/messenger/stats/session-lost', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-NYKISS-Key': key},
        body: JSON.stringify({type: String(type).slice(0, 64), code}),
        keepalive: true,
        credentials: 'omit'
      }).catch(() => {});
    } catch{}
  });
}
