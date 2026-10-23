// NYKISS — the embedded «site» (the Gram build of the worker mini app, /gram/ in an iframe).
// Opened from a left-sidebar menu item FULL SCREEN (the narrow ~420px slider made the CRM cramped).
// A vanilla overlay, like quickBubble.ts.
//
// Protocol with the iframe (postMessage; only our own origin and only from our own iframe):
//   iframe → Gram: {type:'nk:ready'} · {type:'nk:back-depth', depth} · {type:'nk:open-tg-link', url}
//   Gram → iframe: {type:'nk:session', access, refresh} · {type:'nk:back'}

import appImManager from '@lib/appImManager';
import {INTERNAL_LINK_TYPE} from '@lib/internalLink';
import rootScope from '@lib/rootScope';
import PasscodeLockScreenController from '@components/passcodeLock/passcodeLockScreenController';
import {getKey, promptConnect} from '@lib/nykiss/quickBubble';
import {getGramSession, resetGramThrottle, clearGramSession, GramAuthError} from '@lib/nykiss/wcrmAuth';

const NYKISS_WEB_ORIGIN = 'https://wcrm.206.71.148.212.nip.io';
const NYKISS_WEB_URL = NYKISS_WEB_ORIGIN + '/gram/';

const icon = (path: string) =>
  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
const ICON_BACK = icon('M15 18l-6-6 6-6');
const ICON_CLOSE = icon('M6 6l12 12M18 6L6 18');

// What the mini app really needs: copying a key to the clipboard (and its own fullscreen). Camera,
// microphone and clipboard-read are not used by the app, so the iframe does not get them.
const FRAME_ALLOW = 'clipboard-write; fullscreen';
// No top navigation, no pointer lock; the app keeps scripts, its own storage, forms, popups (t.me links, noopener) and dialogs.
const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';
// The iframe must announce itself (nk:ready) and get its session within this time, or the user sees the error screen.
const FRAME_TIMEOUT_MS = 20000;

let overlay: HTMLDivElement | null = null; // also exists while preloading (display:none)
let backBtn: HTMLButtonElement | null = null;
let iframe: HTMLIFrameElement | null = null;
let screenEl: HTMLDivElement | null = null;
let visible = false;
let depth = 0;
let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
let onMessage: ((e: MessageEvent) => void) | null = null;
let frameTimer = 0;
let frameReady = false; // the iframe has announced itself (also while preloading)

// ---- t.me links ---------------------------------------------------------------

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

// What may be opened from the app: https://t.me/<username>, tg://resolve?domain=<username>, and a channel/group
// invite (https://t.me/+<hash>, https://t.me/joinchat/<hash>). Anything else (bots with start, other schemes) is null.
type TgTarget = {userName: string} | {invite: string};
const INVITE_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function parseTgLink(raw: unknown): TgTarget | null {
  if(typeof raw !== 'string' || raw.length > 300) return null;
  let u: URL;
  try { u = new URL(raw); } catch(e) { return null; }
  if(u.protocol === 'https:' && u.hostname === 't.me' && !u.port && !u.username && !u.password) {
    const invite = u.pathname.match(/^\/(?:\+|joinchat\/)([^/]+)\/?$/);
    if(invite) return INVITE_RE.test(invite[1]) ? {invite: invite[1]} : null;
    const m = u.pathname.match(/^\/([^/]+)\/?$/);
    return m && USERNAME_RE.test(m[1]) ? {userName: m[1]} : null;
  }
  if(u.protocol === 'tg:' && u.hostname === 'resolve') {
    const d = u.searchParams.get('domain');
    return d && USERNAME_RE.test(d) ? {userName: d} : null;
  }
  return null;
}

function openTgLink(raw: unknown) {
  const target = parseTgLink(raw);
  if(!target) return;
  closeNykissWeb();
  if('invite' in target) {
    const fallback = () => window.open('https://t.me/+' + target.invite, '_blank', 'noopener');
    import('@lib/internalLinkProcessor').then(({default: processor}) => {
      return processor.processInternalLink({_: INTERNAL_LINK_TYPE.JOIN_CHAT, invite: target.invite});
    }).catch(fallback);
    return;
  }
  Promise.resolve(appImManager.openUsername({userName: target.userName})).catch(() => {
    window.open('https://t.me/' + target.userName, '_blank', 'noopener');
  });
}

// ---- overlay -------------------------------------------------------------------

function setIcon() {
  if(!backBtn) return;
  const back = !!iframe && depth > 0;
  backBtn.innerHTML = back ? ICON_BACK : ICON_CLOSE;
  backBtn.setAttribute('aria-label', back ? 'Назад' : 'Закрыть NYKISS');
}

function stopFrameTimer() {
  window.clearTimeout(frameTimer);
  frameTimer = 0;
}

function destroyFrame() {
  stopFrameTimer();
  if(onMessage) {
    window.removeEventListener('message', onMessage);
    onMessage = null;
  }
  if(iframe) {
    iframe.remove();
    iframe = null;
  }
  depth = 0;
  frameReady = false;
  setIcon();
}

function clearScreen() {
  if(screenEl) {
    screenEl.remove();
    screenEl = null;
  }
}

function ensureOverlay() {
  if(overlay) return;

  overlay = document.createElement('div');
  overlay.className = 'nykiss-web-overlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'display:none', 'flex-direction:column',
    'background:#070807'
  ].join(';');

  // The back / close button: a gold circle over the iframe, clear of the notch.
  backBtn = document.createElement('button');
  backBtn.style.cssText = [
    'position:absolute',
    'top:calc(env(safe-area-inset-top, 0px) + 12px)',
    'left:calc(env(safe-area-inset-left, 0px) + 12px)',
    'z-index:2',
    'width:40px', 'height:40px', 'border:0', 'border-radius:50%',
    'cursor:pointer',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(10,12,10,0.72)',
    'backdrop-filter:blur(8px)', '-webkit-backdrop-filter:blur(8px)',
    'box-shadow:0 2px 10px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(216,180,81,0.45)',
    'color:#e9c860'
  ].join(';');
  backBtn.addEventListener('click', () => {
    if(iframe && depth > 0) {
      if(iframe.contentWindow) iframe.contentWindow.postMessage({type: 'nk:back'}, NYKISS_WEB_ORIGIN);
    } else {
      closeNykissWeb();
    }
  });
  overlay.append(backBtn);
  document.body.append(overlay);
  setIcon();
}

function showScreen(opts: {title: string, text: string, action?: {label: string, run: () => void}}) {
  ensureOverlay();
  destroyFrame();
  clearScreen();

  screenEl = document.createElement('div');
  screenEl.style.cssText = [
    'flex:1 1 auto', 'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'gap:14px', 'padding:72px 28px 28px', 'text-align:center', 'box-sizing:border-box',
    'background:radial-gradient(120% 80% at 50% 0%, rgba(201,162,39,0.10), rgba(7,8,7,0) 60%), #070807',
    'font-family:Manrope,system-ui,sans-serif', 'color:#e9e6dc'
  ].join(';');

  const mark = document.createElement('div');
  mark.textContent = 'N';
  mark.style.cssText = 'width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:600 28px/1 Fraunces,Georgia,serif;color:#e9c860;box-shadow:inset 0 0 0 1px rgba(201,162,39,0.55);background:rgba(201,162,39,0.08);';

  const h = document.createElement('h2');
  h.textContent = opts.title;
  h.style.cssText = 'margin:6px 0 0;font:600 26px/1.15 Fraunces,Georgia,serif;color:#f1ead2;letter-spacing:-.005em;';

  const p = document.createElement('p');
  p.textContent = opts.text;
  p.style.cssText = 'margin:0;max-width:320px;font:500 14px/1.45 Manrope,system-ui,sans-serif;color:#a9a692;';

  screenEl.append(mark, h, p);

  if(opts.action) {
    const b = document.createElement('button');
    b.textContent = opts.action.label;
    b.style.cssText = 'margin-top:8px;border:0;cursor:pointer;padding:14px 26px;border-radius:14px;font:800 13px/1 Manrope,system-ui,sans-serif;letter-spacing:.04em;color:#1a1405;background:linear-gradient(180deg,#e9c860,#C9A227);box-shadow:0 6px 20px rgba(201,162,39,0.28);';
    b.addEventListener('click', opts.action.run);
    screenEl.append(b);
  }

  overlay.append(screenEl);
}

function showKeyScreen(reason?: string) {
  showScreen({
    title: 'Вставь ключ',
    text: reason || 'Чтобы открыть CRM внутри Gram, подключи свой ключ NYKISS Gram (он в мини-аппе, раздел «Настройки»).',
    action: {
      label: 'Подключить CRM',
      run: async() => {
        const ok = await promptConnect();
        if(ok && overlay && visible) {
          resetGramThrottle();
          startFrame();
        }
      }
    }
  });
}

function showError(e: unknown) {
  const code = e instanceof GramAuthError ? e.code : 'network';
  if(code === 'no-key') {
    showKeyScreen();
  } else if(code === 'bad-key') {
    showKeyScreen('Ключ слетел или не подошёл. Подключись заново.');
  } else if(code === 'forbidden') {
    const detail = e instanceof GramAuthError ? (e.detail || '').toLowerCase() : '';
    showScreen({
      title: 'Вход закрыт',
      text: detail.includes('banned') ? 'Аккаунт заблокирован.'
        : detail.includes('suspended') ? 'Аккаунт приостановлен.'
          : 'Доступ запрещён.',
      action: {label: 'Закрыть', run: closeNykissWeb}
    });
  } else {
    showScreen({
      title: 'Не получилось',
      text: 'Не получилось, попробуй ещё раз.',
      action: {label: 'Повторить', run: () => { resetGramThrottle(); startFrame(); }}
    });
  }
}

// An error on a hidden (preloaded) iframe: drop it quietly, open will show the screen itself.
function failFrame(e: unknown) {
  if(visible) showError(e);
  else destroyFrame();
}

function handleMessage(e: MessageEvent) {
  // Only our origin AND only our iframe's window: everything else is ignored without a trace.
  if(e.origin !== NYKISS_WEB_ORIGIN) return;
  if(!iframe || e.source !== iframe.contentWindow) return;
  const d = e.data;
  if(!d || typeof d !== 'object' || typeof d.type !== 'string') return;

  switch(d.type) {
    case 'nk:ready': {
      frameReady = true;
      if(visible) markNykissWebSeen(); // a hidden preload does not count: nobody has seen it
      const frame = iframe;
      getGramSession().then((s) => {
        if(iframe !== frame || !frame.contentWindow) return; // the iframe was closed or replaced
        stopFrameTimer();
        frame.contentWindow.postMessage({type: 'nk:session', access: s.access, refresh: s.refresh}, NYKISS_WEB_ORIGIN);
      }, (err) => {
        if(iframe === frame) failFrame(err);
      });
      break;
    }
    case 'nk:back-depth': {
      depth = typeof d.depth === 'number' && d.depth > 0 ? 1 : 0; // only "is there somewhere to go back" matters
      setIcon();
      break;
    }
    case 'nk:open-tg-link': {
      if(visible) openTgLink(d.url);
      break;
    }
  }
}

// Creates the iframe (shown or hidden, by `visible`) and the message listener.
function startFrame() {
  ensureOverlay();
  destroyFrame();
  clearScreen();

  iframe = document.createElement('iframe');
  iframe.src = NYKISS_WEB_URL;
  iframe.setAttribute('allow', FRAME_ALLOW);
  iframe.setAttribute('sandbox', FRAME_SANDBOX);
  iframe.referrerPolicy = 'no-referrer';
  iframe.style.cssText = 'flex:1 1 auto;width:100%;height:100%;border:0;display:block;background:#070807;';
  overlay.prepend(iframe);

  onMessage = handleMessage;
  window.addEventListener('message', onMessage);
  const frame = iframe;
  frameTimer = window.setTimeout(() => {
    if(iframe === frame) failFrame(new GramAuthError('network'));
  }, FRAME_TIMEOUT_MS);
  setIcon();
}

export function closeNykissWeb() {
  if(onKeyDown) {
    document.removeEventListener('keydown', onKeyDown);
    onKeyDown = null;
  }
  destroyFrame();
  clearScreen();
  clearGramSession();
  if(overlay) {
    overlay.remove();
    overlay = null;
    backBtn = null;
  }
  visible = false;
}

// ---- first-run hint ------------------------------------------------------------
// Until the site has really loaded once for this account, the NYKISS menu item is outlined in gold and the
// hamburger carries a dot (CSS: html.nk-web-unseen). The flag is per account (rootScope.myId) when the id is known.

const SEEN_KEY = 'nk_web_seen';
const AUTO_KEY = 'nk_web_auto_n'; // how many times it opened by itself without a successful load
const AUTO_MAX = 2;
let seenInMemory = false;

const seenKey = () => {
  const id = +rootScope.myId;
  return id ? SEEN_KEY + '_' + id : SEEN_KEY;
};

function storageWorks() {
  try {
    localStorage.setItem('nk_probe', '1');
    localStorage.removeItem('nk_probe');
    return true;
  } catch(e) {
    return false;
  }
}

// No localStorage: it cannot be remembered, so the hint stays visible (false) for this session only.
export function isNykissWebSeen() {
  if(seenInMemory) return true;
  try { return localStorage.getItem(seenKey()) === '1'; } catch(e) { return false; }
}

function markNykissWebSeen() {
  seenInMemory = true;
  try { localStorage.setItem(seenKey(), '1'); } catch(e) {}
  document.documentElement.classList.remove('nk-web-unseen');
}

// The menu label: text + the outline (an SVG rect drawn along its path) + a dot. Only visible with html.nk-web-unseen.
export function createNykissMenuLabel() {
  const span = document.createElement('span');
  span.textContent = 'NYKISS';
  span.insertAdjacentHTML('beforeend',
    '<svg class="nk-hint-ring" aria-hidden="true"><rect pathLength="1" rx="12" ry="12"/></svg><i class="nk-hint-dot" aria-hidden="true"></i>');
  return span;
}

function hasBlocker() {
  if(document.hidden) return true;
  if(PasscodeLockScreenController.getIsLocked() || document.querySelector('.passcode-lock-screen')) return true;
  // any popup/modal, an open menu, the context menu, a media viewer
  return !!document.querySelector('.popup.active, .btn-menu.active, .media-viewer-whole, .modal.active');
}

// Called once at start. Shows the hint after login and, once, opens the site by itself, when Gram is logged in, the chats are
// loaded and nothing is in the way. Not marked as seen until the iframe says nk:ready (or the person clicks the item).
export function initNykissHint() {
  let chatsLoaded = false;
  rootScope.addEventListener('dialogs_multiupdate', () => { chatsLoaded = true; });

  let loggedSince = 0;
  let tries = 0;
  const tick = window.setInterval(() => {
    if(!+rootScope.myId) return; // not logged in
    if(!loggedSince) {
      loggedSince = Date.now();
      if(!isNykissWebSeen()) document.documentElement.classList.add('nk-web-unseen');
    }
    if(isNykissWebSeen()) { window.clearInterval(tick); return; }
    if(++tries > 150) { window.clearInterval(tick); return; } // ~5 minutes, then only the hint stays
    if(visible || !storageWorks()) return;
    if(!chatsLoaded && Date.now() - loggedSince < 20000) return;
    if(Date.now() - loggedSince < 4000 || hasBlocker()) return;
    let n = 0;
    try { n = +localStorage.getItem(AUTO_KEY) || 0; } catch(e) {}
    window.clearInterval(tick);
    if(n >= AUTO_MAX) return;
    try { localStorage.setItem(AUTO_KEY, String(n + 1)); } catch(e) {}
    openNykissWeb(true);
  }, 2000);
}

// auto: opened by the hint, not by the person; only a real click or a loaded site turns the hint off.
export function openNykissWeb(auto = false) {
  if(visible) return; // already open
  visible = true;
  if(!auto) markNykissWebSeen();
  resetGramThrottle();
  ensureOverlay();
  overlay.style.display = 'flex';

  if(!getKey()) {
    showKeyScreen();
  } else if(!iframe) {
    startFrame();
  } else {
    // the preloaded iframe: it has the session already if it was quick enough, otherwise it asks itself
    if(frameReady) markNykissWebSeen();
    setIcon();
  }

  onKeyDown = (e: KeyboardEvent) => {
    if(e.key === 'Escape') closeNykissWeb();
  };
  document.addEventListener('keydown', onKeyDown);
}

// A hidden iframe in advance, only when a key already exists: the first open after Gram loads is instant.
// close destroys the iframe (the next open gets a fresh one).
export function preloadNykissWeb() {
  if(overlay || visible || !getKey()) return;
  startFrame();
}
