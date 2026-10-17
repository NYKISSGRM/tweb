'use strict';

const path = require('path');
const fs = require('fs');
const {app, BrowserWindow, Menu, session, shell, screen, systemPreferences} = require('electron');

const START_URL = 'https://nykissgrm.github.io/tweb/';
const BG_COLOR = '#070807';
const PARTITION = 'persist:nykiss';
const APP_ID = 'io.github.nykissgrm.gram';
const IS_DEV = !app.isPackaged || process.env.NYKISS_DEVTOOLS === '1';

// Hosts the window may navigate to / be granted permissions on.
// Everything else goes to the system browser (http/https/mailto) or is dropped.
const OWN_HOSTS = ['nykissgrm.github.io', 'wcrm.206.71.148.212.nip.io'];
const TELEGRAM_DOMAIN = 'telegram.org'; // + *.telegram.org (login / oauth)
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'notifications',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen'
]);
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

app.setName('NYKISS Gram');
if(process.platform === 'win32') app.setAppUserModelId(APP_ID);

function parseUrl(url) {
  try {
    return new URL(url);
  } catch(err) {
    return null;
  }
}

function isOwnOrigin(url) {
  const u = parseUrl(url);
  return !!u && u.protocol === 'https:' && OWN_HOSTS.includes(u.hostname);
}

// Navigation allowlist (top-level frame).
function isAllowedNavigation(url) {
  const u = parseUrl(url);
  if(!u || u.protocol !== 'https:') return false;
  if(u.hostname === OWN_HOSTS[0]) return u.pathname === '/tweb' || u.pathname.startsWith('/tweb/');
  if(u.hostname === OWN_HOSTS[1]) return true;
  return u.hostname === TELEGRAM_DOMAIN || u.hostname.endsWith('.' + TELEGRAM_DOMAIN);
}

function openExternal(url) {
  const u = parseUrl(url);
  if(u && EXTERNAL_PROTOCOLS.has(u.protocol)) shell.openExternal(u.href);
}

// ---- remembered window size / position ----
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadState() {
  const def = {width: 1280, height: 820};
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if(typeof s.width !== 'number' || typeof s.height !== 'number') return def;
    const state = {width: Math.max(s.width, 480), height: Math.max(s.height, 600), maximized: !!s.maximized};
    if(typeof s.x === 'number' && typeof s.y === 'number') {
      const visible = screen.getAllDisplays().some((d) => {
        const b = d.workArea;
        return s.x < b.x + b.width - 60 && s.x + state.width > b.x + 60 &&
          s.y >= b.y - 10 && s.y < b.y + b.height - 60;
      });
      if(visible) {
        state.x = s.x;
        state.y = s.y;
      }
    }
    return state;
  } catch(err) {
    return def;
  }
}

function saveState(win) {
  try {
    const maximized = win.isMaximized();
    const b = maximized ? (win.__normalBounds || win.getNormalBounds()) : win.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({...b, maximized}));
  } catch(err) {}
}

// ---- session hardening: permissions only for our origins ----
function setupSession(ses) {
  const originOf = (url) => (parseUrl(url) || {}).origin || '';
  const allowed = (permission, url) => ALLOWED_PERMISSIONS.has(permission) && (isOwnOrigin(url) || (originOf(url) && isAllowedNavigation(url)));

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const ok = allowed(permission, details.requestingUrl || wc.getURL());
    if(!ok) return callback(false);
    if(permission === 'media' && process.platform === 'darwin') {
      // macOS asks for system camera/microphone access; without it getUserMedia fails silently.
      const types = (details.mediaTypes || []).filter((t) => t === 'audio' || t === 'video');
      Promise.all(types.map((t) => systemPreferences.askForMediaAccess(t === 'audio' ? 'microphone' : 'camera')))
      .then((r) => callback(r.every(Boolean)), () => callback(false));
      return;
    }
    callback(true);
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => allowed(permission, requestingOrigin));
  ses.setDevicePermissionHandler(() => false);
}

// A tiny dark page for "no connection", retried automatically.
function offlinePage() {
  const html = '<!doctype html><meta charset=utf-8><body style="margin:0;background:' + BG_COLOR +
    ';color:#e9c860;font:16px system-ui;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">' +
    '<div><div style="font-size:48px;font-weight:700">N</div><p>Нет соединения с NYKISS Gram.<br>Повторяю попытку…</p></div>';
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

let mainWindow = null;

function createWindow() {
  const state = loadState();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 480,
    minHeight: 600,
    show: false,
    backgroundColor: BG_COLOR,
    title: 'NYKISS Gram',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true
    }
  });
  mainWindow = win;
  if(state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  win.on('resize', () => { if(!win.isMaximized()) win.__normalBounds = win.getBounds(); });
  win.on('move', () => { if(!win.isMaximized()) win.__normalBounds = win.getBounds(); });
  win.on('close', () => saveState(win));
  win.on('closed', () => { mainWindow = null; });

  const wc = win.webContents;

  // Page titles are fine, but the window keeps the brand name when the page has none.
  wc.on('page-title-updated', (e, title) => { if(!title) e.preventDefault(); });

  wc.setWindowOpenHandler(({url}) => {
    if(isAllowedNavigation(url)) {
      // e.g. our own sub-pages: open in a safe child window sharing the same session
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          backgroundColor: BG_COLOR,
          autoHideMenuBar: true,
          webPreferences: {contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true}
        }
      };
    }
    openExternal(url);
    return {action: 'deny'};
  });

  const guard = (e, url) => {
    if(isAllowedNavigation(url)) return;
    e.preventDefault();
    openExternal(url);
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);

  let retryTimer = null;
  wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if(!isMainFrame || code === -3 /* aborted */ || url.startsWith('data:')) return;
    wc.loadURL(offlinePage());
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if(!win.isDestroyed()) wc.loadURL(START_URL); }, 5000);
  });

  // Minimal context menu for places where the page does not draw its own.
  wc.on('context-menu', (e, params) => {
    const items = [];
    if(params.isEditable) {
      items.push({role: 'cut'}, {role: 'copy'}, {role: 'paste'}, {type: 'separator'}, {role: 'selectAll'});
    } else if(params.selectionText) {
      items.push({role: 'copy'});
    }
    if(items.length) Menu.buildFromTemplate(items).popup({window: win});
  });

  wc.loadURL(START_URL);
  return win;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const view = [
    {role: 'reload', label: 'Перезагрузить'},
    {role: 'forceReload', label: 'Перезагрузить без кэша'},
    {type: 'separator'},
    {role: 'resetZoom', label: 'Масштаб 100%'},
    {role: 'zoomIn', label: 'Увеличить'},
    {role: 'zoomOut', label: 'Уменьшить'},
    // Ctrl/Cmd+= without Shift is what people actually press
    {role: 'zoomIn', accelerator: 'CommandOrControl+=', visible: false},
    {type: 'separator'},
    {role: 'togglefullscreen', label: 'Полный экран'}
  ];
  if(IS_DEV) view.push({type: 'separator'}, {role: 'toggleDevTools', label: 'Инструменты разработчика'});

  const template = [
    ...(isMac ? [{role: 'appMenu'}] : []),
    {label: 'Правка', submenu: [
      {role: 'undo', label: 'Отменить'},
      {role: 'redo', label: 'Повторить'},
      {type: 'separator'},
      {role: 'cut', label: 'Вырезать'},
      {role: 'copy', label: 'Копировать'},
      {role: 'paste', label: 'Вставить'},
      {role: 'selectAll', label: 'Выделить всё'}
    ]},
    {label: 'Вид', submenu: view},
    {label: 'Окно', submenu: [
      {role: 'minimize', label: 'Свернуть'},
      ...(isMac ? [{role: 'zoom'}, {type: 'separator'}, {role: 'front'}] : [{role: 'close', label: 'Закрыть'}])
    ]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Defence in depth: no <webview>, no extra attach, UA without the Electron token.
app.on('web-contents-created', (e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

if(!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if(!mainWindow) return;
    if(mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    const ses = session.fromPartition(PARTITION);
    ses.setUserAgent(ses.getUserAgent().replace(/\s?Electron\/\S+/, '').replace(/\s?nykiss-gram-desktop\/\S+/, ''));
    setupSession(ses);
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if(!BrowserWindow.getAllWindows().length) createWindow();
      else if(mainWindow) mainWindow.show();
    });
  });

  app.on('window-all-closed', () => {
    if(process.platform !== 'darwin') app.quit();
  });
}
