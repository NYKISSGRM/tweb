'use strict';
// Smoke test: launches the real Electron app against the LIVE site (login screen only,
// no account is touched). Run: npm test
const {_electron: electron} = require('playwright-core');
const {spawnSync} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

delete process.env.ELECTRON_RUN_AS_NODE; // set by some shells/IDEs; it turns Electron into plain node
const root = path.join(__dirname, '..');
const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, {recursive: true});
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nykiss-gram-test-'));
const results = [];
const check = (name, ok, info) => {
  results.push(ok);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (info ? ' :: ' + info : ''));
};

(async() => {
  const app = await electron.launch({
    args: appArgs(),
    executablePath: process.env.NYKISS_EXE || undefined
  });
  const consoleErrors = [];
  const page = await app.firstWindow();
  page.on('console', (m) => { if(m.type() === 'error') consoleErrors.push(m.text()); });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(8000);
  check('url is the Gram site', page.url().startsWith('https://nykissgrm.github.io/tweb/'), page.url());
  check('window title', (await page.title()).length > 0, await page.title());
  await page.screenshot({path: path.join(shots, 'window.png')});

  const prefs = await app.evaluate(({BrowserWindow}) => {
    const w = BrowserWindow.getAllWindows()[0];
    const p = w.webContents.getLastWebPreferences();
    return {ci: p.contextIsolation, ni: p.nodeIntegration, sb: p.sandbox, ws: p.webSecurity, bg: w.getBackgroundColor(), count: BrowserWindow.getAllWindows().length};
  });
  check('contextIsolation/nodeIntegration/sandbox/webSecurity', prefs.ci === true && prefs.ni === false && prefs.sb === true && prefs.ws !== false, JSON.stringify(prefs));
  check('backgroundColor #070807', String(prefs.bg).toLowerCase() === '#070807', prefs.bg);
  check('renderer has no node globals', await page.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined'));

  // external links must go to the system browser, never into the window
  await app.evaluate(({shell}) => { global.__opened = []; shell.openExternal = (u) => { global.__opened.push(u); return Promise.resolve(); }; });
  await page.evaluate(() => { window.open('https://example.com/a', '_blank'); });
  await page.evaluate(() => { const a = document.createElement('a'); a.href = 'https://example.org/b'; a.target = '_blank'; document.body.appendChild(a); a.click(); });
  await page.evaluate(() => { location.href = 'https://example.net/c'; });
  await page.waitForTimeout(1500);
  const opened = await app.evaluate(() => global.__opened);
  check('external window.open/_blank -> system browser', opened.includes('https://example.com/a') && opened.includes('https://example.org/b'), JSON.stringify(opened));
  check('navigation to foreign domain blocked (and sent out)', opened.includes('https://example.net/c') && page.url().startsWith('https://nykissgrm.github.io/tweb/'), page.url());
  await page.evaluate(() => { window.open('javascript:alert(1)'); window.open('file:///etc/hosts'); });
  await page.waitForTimeout(500);
  const opened2 = await app.evaluate(() => global.__opened);
  check('javascript:/file: never opened', opened2.length === opened.length);
  const count = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length);
  check('no extra windows', count === 1, String(count));

  // second launch with same user data dir must not create a window
  const second = spawnSync(app_exe(), appArgs(), {timeout: 20000});
  await page.waitForTimeout(1000);
  const count2 = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length);
  check('second launch exits, still one window', second.status === 0 && count2 === 1, 'exit=' + second.status + ' windows=' + count2);

  const bad = consoleErrors.filter((t) => /blocked|refused|CSP|Content Security|ERR_BLOCKED/i.test(t));
  check('no blocking errors in console', bad.length === 0, bad.slice(0, 3).join(' | '));
  if(consoleErrors.length) console.log('console errors (info):', consoleErrors.slice(0, 5));

  await app.close();
  fs.rmSync(userData, {recursive: true, force: true});
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });

function app_exe() {
  return process.env.NYKISS_EXE || require('electron');
}

// with NYKISS_EXE (a packaged app) the app path must not be passed
function appArgs() {
  return (process.env.NYKISS_EXE ? [] : [root]).concat('--user-data-dir=' + userData);
}
