// NYKISS Gram — every open client picks up a new build by itself. The page asks the server for a fresh index.html
// (never from a cache), and when the main script it names is not the one that is running, reloads at a moment that
// costs nothing: the window has been hidden or untouched for a while, there is no draft, no popup, no media viewer.

const CHECK_EVERY_MS = 5 * 60 * 1000;
const IDLE_BEFORE_RELOAD_MS = 90 * 1000;
const RELOAD_GUARD_KEY = 'nk_autoupdate_at';
const RELOAD_GUARD_MS = 10 * 60 * 1000;

// ./index-bchVGsES.js out of <script type="module" src="./index-bchVGsES.js">
export function parseMainScript(html: string): string | undefined {
  const match = html.match(/<script[^>]+type="module"[^>]+src="([^"]*\/)?(index-[A-Za-z0-9_-]+\.js)"/);
  return match?.[2];
}

export function shouldReloadNow(state: {
  hasNewBuild: boolean,
  hidden: boolean,
  idleMs: number,
  busy: boolean,
  lastReloadAgoMs: number
}) {
  if(!state.hasNewBuild || state.busy) return false;
  if(state.lastReloadAgoMs < RELOAD_GUARD_MS) return false; // a build that keeps differing must not loop
  return state.hidden || state.idleMs >= IDLE_BEFORE_RELOAD_MS;
}

function runningMainScript() {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="index-"]')?.getAttribute('src');
  return src?.match(/(index-[A-Za-z0-9_-]+\.js)/)?.[1];
}

function isBusy() {
  const draft = document.querySelector('.input-message-input')?.textContent?.trim();
  return !!draft || !!document.querySelector('.popup.active, .media-viewer-whole, .group-call, .call-container');
}

function lastReloadAgo() {
  try {
    return Date.now() - (+localStorage.getItem(RELOAD_GUARD_KEY) || 0);
  } catch(e) {
    return 0;
  }
}

export function initAutoUpdate() {
  const running = runningMainScript();
  if(!running) return; // dev server: no hashed bundle

  let hasNewBuild = false;
  let lastTouch = Date.now();
  const touch = () => { lastTouch = Date.now(); };
  (['pointerdown', 'keydown', 'wheel', 'touchstart'] as const).forEach((type) => {
    window.addEventListener(type, touch, {passive: true, capture: true});
  });

  const tryReload = () => {
    if(!shouldReloadNow({
      hasNewBuild,
      hidden: document.hidden,
      idleMs: Date.now() - lastTouch,
      busy: isBusy(),
      lastReloadAgoMs: lastReloadAgo()
    })) return;

    try { localStorage.setItem(RELOAD_GUARD_KEY, String(Date.now())); } catch(e) {}
    location.reload();
  };

  const check = async() => {
    try {
      const response = await fetch(location.origin + location.pathname, {cache: 'no-store'});
      if(!response.ok) return;
      const latest = parseMainScript(await response.text());
      hasNewBuild = !!latest && latest !== running;
    } catch(e) {
      return; // offline: try on the next round
    }
    tryReload();
  };

  window.setInterval(check, CHECK_EVERY_MS);
  window.setInterval(tryReload, 30 * 1000);
  document.addEventListener('visibilitychange', () => document.hidden ? tryReload() : check());
  window.setTimeout(check, 20 * 1000);
}
