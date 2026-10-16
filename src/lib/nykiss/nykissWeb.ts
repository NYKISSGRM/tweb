// NYKISS — встроенный «сайт» (Gram-сборка мини-аппы воркера, /gram/ в iframe).
// Открывается пунктом меню в левом сайдбаре НА ВЕСЬ ЭКРАН (а не в узком слайдере ~420px,
// где CRM была тесной и «не работала»). Ванильный оверлей, как quickBubble.ts.
//
// Протокол с iframe (postMessage, только свой origin и только от своего iframe):
//   iframe → Gram: {type:'nk:ready'} · {type:'nk:back-depth', depth} · {type:'nk:open-tg-link', url}
//   Gram → iframe: {type:'nk:session', access, refresh} · {type:'nk:back'}

import appImManager from '@lib/appImManager';
import {getKey, promptConnect} from '@lib/nykiss/quickBubble';
import {getGramSession, resetGramThrottle, GramAuthError} from '@lib/nykiss/wcrmAuth';

const NYKISS_WEB_ORIGIN = 'https://wcrm.206.71.148.212.nip.io';
const NYKISS_WEB_URL = NYKISS_WEB_ORIGIN + '/gram/';

const ICON_BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const ICON_CLOSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

let overlay: HTMLDivElement | null = null; // существует и при прелоаде (display:none)
let backBtn: HTMLButtonElement | null = null;
let iframe: HTMLIFrameElement | null = null;
let screenEl: HTMLDivElement | null = null;
let visible = false;
let depth = 0;
let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
let onMessage: ((e: MessageEvent) => void) | null = null;

// ---- ссылки t.me ---------------------------------------------------------------

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

// Только https://t.me/<username> и tg://resolve?domain=<username>, остальное — null.
function parseTgLink(raw: unknown): string | null {
  if(typeof raw !== 'string' || raw.length > 300) return null;
  let u: URL;
  try { u = new URL(raw); } catch(e) { return null; }
  if(u.protocol === 'https:' && u.hostname === 't.me' && !u.port && !u.username && !u.password) {
    const m = u.pathname.match(/^\/([^/]+)\/?$/);
    return m && USERNAME_RE.test(m[1]) ? m[1] : null;
  }
  if(u.protocol === 'tg:' && u.hostname === 'resolve') {
    const d = u.searchParams.get('domain');
    return d && USERNAME_RE.test(d) ? d : null;
  }
  return null;
}

function openTgLink(raw: unknown) {
  const userName = parseTgLink(raw);
  if(!userName) return;
  closeNykissWeb();
  Promise.resolve(appImManager.openUsername({userName})).catch(() => {
    window.open('https://t.me/' + userName, '_blank', 'noopener');
  });
}

// ---- оверлей -------------------------------------------------------------------

function setIcon() {
  if(!backBtn) return;
  const back = !!iframe && depth > 0;
  backBtn.innerHTML = back ? ICON_BACK : ICON_CLOSE;
  backBtn.setAttribute('aria-label', back ? 'Назад' : 'Закрыть NYKISS');
}

function destroyFrame() {
  if(onMessage) {
    window.removeEventListener('message', onMessage);
    onMessage = null;
  }
  if(iframe) {
    iframe.remove();
    iframe = null;
  }
  depth = 0;
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
    'position:fixed', 'inset:0', 'z-index:100000',
    'display:none', 'flex-direction:column',
    'background:#070807'
  ].join(';');

  // Кнопка «назад/закрыть» — золотой круг, поверх iframe, с учётом вырезов.
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

// Ошибка у скрытого (прелоад) iframe: молча сносим, экран покажет сам open.
function failFrame(e: unknown) {
  if(visible) showError(e);
  else destroyFrame();
}

function handleMessage(e: MessageEvent) {
  // Только свой origin и только окно нашего iframe — остальное молча мимо.
  if(e.origin !== NYKISS_WEB_ORIGIN) return;
  if(!iframe || e.source !== iframe.contentWindow) return;
  const d = e.data;
  if(!d || typeof d !== 'object') return;

  switch(d.type) {
    case 'nk:ready': {
      const frame = iframe;
      getGramSession().then((s) => {
        if(iframe !== frame || !frame.contentWindow) return; // iframe уже закрыт/заменён
        frame.contentWindow.postMessage({type: 'nk:session', access: s.access, refresh: s.refresh}, NYKISS_WEB_ORIGIN);
      }, (err) => {
        if(iframe === frame) failFrame(err);
      });
      break;
    }
    case 'nk:back-depth': {
      depth = typeof d.depth === 'number' && d.depth > 0 ? 1 : 0;
      setIcon();
      break;
    }
    case 'nk:open-tg-link': {
      if(visible) openTgLink(d.url);
      break;
    }
  }
}

// Создаёт iframe (видимый или скрытый — по `visible`) + слушатель сообщений.
function startFrame() {
  ensureOverlay();
  destroyFrame();
  clearScreen();

  iframe = document.createElement('iframe');
  iframe.src = NYKISS_WEB_URL;
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write; camera; microphone; fullscreen');
  iframe.style.cssText = 'flex:1 1 auto;width:100%;height:100%;border:0;display:block;background:#070807;';
  overlay.prepend(iframe);

  onMessage = handleMessage;
  window.addEventListener('message', onMessage);
  setIcon();
}

export function closeNykissWeb() {
  if(onKeyDown) {
    document.removeEventListener('keydown', onKeyDown);
    onKeyDown = null;
  }
  destroyFrame();
  clearScreen();
  if(overlay) {
    overlay.remove();
    overlay = null;
    backBtn = null;
  }
  visible = false;
}

export function openNykissWeb() {
  if(visible) return; // уже открыт
  visible = true;
  resetGramThrottle();
  ensureOverlay();
  overlay.style.display = 'flex';

  if(!getKey()) {
    showKeyScreen();
  } else if(!iframe) {
    startFrame();
  } else {
    // iframe из прелоада: сессию он уже получил, если успел; иначе спросит сам.
    setIcon();
  }

  onKeyDown = (e: KeyboardEvent) => {
    if(e.key === 'Escape') closeNykissWeb();
  };
  document.addEventListener('keydown', onKeyDown);
}

// Скрытый iframe заранее — только если ключ уже есть. Первый open после загрузки Gram
// становится мгновенным. После close iframe уничтожается (следующий open — свежий).
export function preloadNykissWeb() {
  if(overlay || visible || !getKey()) return;
  startFrame();
}
