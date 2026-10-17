// src/lib/nykiss/pwa.ts
// NYKISS Gram — a quiet «Установить NYKISS» hint. Chrome/Edge (desktop, Android) hand us `beforeinstallprompt`;
// iPhone Safari has no such event, so it gets a short how-to. Shown once: closing it (or installing) is for good.
// Never shown when the app already runs as an installed one.

import {IS_APPLE_MOBILE} from '@environment/userAgent';
import IS_STANDALONE from '@environment/standalone';

const DISMISSED_LS = 'nykiss_pwa_hint_dismissed';
const SHOW_AFTER_MS = 5000;
const STYLE_ID = 'nykiss-pwa-style';
const INSTALL_PAGE = 'install.html';

type InstallPromptEvent = Event & {
  prompt(): Promise<void>,
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>
};

let deferred: InstallPromptEvent;
let shown = false;
let rootEl: HTMLElement;

// localStorage can throw (private mode, blocked site data): the hint then shows again next load, nothing breaks.
function isDismissed() {
  try { return localStorage.getItem(DISMISSED_LS) === '1'; } catch(e) { return false; }
}

function dismiss() {
  try { localStorage.setItem(DISMISSED_LS, '1'); } catch(e) { /* private mode */ }
  rootEl?.remove();
  rootEl = undefined;
}

function isInstalled() {
  return IS_STANDALONE || (navigator as any).standalone === true;
}

function addStyle() {
  if(document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.nykiss-pwa{position:fixed;z-index:9000;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));max-width:420px;margin:0 auto;box-sizing:border-box;padding:14px 16px;background:#070807;color:#e8e4d8;border:1px solid rgba(201,162,39,.4);border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.55);font:500 14px/1.4 Manrope,system-ui,sans-serif}
.nykiss-pwa__title{margin:0 0 4px;padding-inline-end:28px;font:600 16px/1.25 Fraunces,Georgia,serif;color:#C9A227}
.nykiss-pwa__text{margin:0 0 12px;color:#b9b5a8}
.nykiss-pwa__row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.nykiss-pwa__btn{appearance:none;border:1px solid #C9A227;border-radius:10px;padding:9px 16px;font:700 14px/1 Manrope,system-ui,sans-serif;cursor:pointer;background:#C9A227;color:#070807;text-decoration:none}
.nykiss-pwa__btn--ghost{background:transparent;color:#C9A227}
.nykiss-pwa__x{position:absolute;top:6px;inset-inline-end:6px;width:32px;height:32px;border:0;background:transparent;color:#8d8a7e;font-size:22px;line-height:1;cursor:pointer;border-radius:8px}
.nykiss-pwa__x:hover{color:#C9A227}
`;
  document.head.appendChild(style);
}

function create(ios: boolean) {
  addStyle();
  const root = document.createElement('div');
  root.className = 'nykiss-pwa';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Установить NYKISS Gram');
  root.innerHTML = `<button class="nykiss-pwa__x" type="button" aria-label="Закрыть">&times;</button>` +
    `<p class="nykiss-pwa__title">Установить NYKISS</p>` +
    `<p class="nykiss-pwa__text">${ios ?
      'На iPhone: кнопка «Поделиться» в Safari, затем «На экран Домой».' :
      'Отдельное окно и значок на рабочем столе или на экране телефона.'}</p>` +
    `<div class="nykiss-pwa__row">` +
    (ios ? '' : `<button class="nykiss-pwa__btn" type="button" data-act="install">Установить</button>`) +
    `<a class="nykiss-pwa__btn nykiss-pwa__btn--ghost" href="${INSTALL_PAGE}" target="_blank" rel="noopener">Как установить</a>` +
    `</div>`;

  root.querySelector('.nykiss-pwa__x').addEventListener('click', dismiss);
  root.querySelector('[data-act="install"]')?.addEventListener('click', async() => {
    const event = deferred;
    deferred = undefined;
    dismiss();
    try {
      await event.prompt();
      await event.userChoice;
    } catch(e) { /* the browser already used the prompt */ }
  });
  document.body.appendChild(root);
  rootEl = root;
}

function show() {
  if(shown || isDismissed() || isInstalled() || !document.body) return;
  const ios = IS_APPLE_MOBILE && !deferred;
  if(!ios && !deferred) return;
  shown = true;
  create(ios);
}

export function initPwa() {
  if(isInstalled()) return;

  // the event can come before anything else is ready, so the listener is attached at once and the hint waits
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    if(isDismissed()) return;
    window.setTimeout(show, SHOW_AFTER_MS);
  });
  window.addEventListener('appinstalled', () => {
    deferred = undefined;
    dismiss();
  });

  if(IS_APPLE_MOBILE) window.setTimeout(show, SHOW_AFTER_MS);
}
