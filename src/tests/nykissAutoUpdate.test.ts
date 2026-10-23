import {describe, expect, it} from 'vitest';
import {parseMainScript, shouldReloadNow} from '@lib/nykiss/autoUpdate';

const base = {hasNewBuild: true, hidden: false, idleMs: 0, busy: false, lastReloadAgoMs: 60 * 60 * 1000};

describe('autoUpdate', () => {
  it('reads the main script name out of index.html', () => {
    const html = '<head><script type="module" crossorigin src="./index-bchVGsES.js"></script><link rel="modulepreload" href="./app-Cq1sNZ-H.js"></head>';
    expect(parseMainScript(html)).toBe('index-bchVGsES.js');
    expect(parseMainScript('<html></html>')).toBeUndefined();
  });

  it('does nothing without a new build', () => {
    expect(shouldReloadNow({...base, hasNewBuild: false, hidden: true})).toBe(false);
  });

  it('waits while the person works', () => {
    expect(shouldReloadNow({...base, idleMs: 10 * 1000})).toBe(false);
  });

  it('reloads when the window is hidden or idle', () => {
    expect(shouldReloadNow({...base, hidden: true})).toBe(true);
    expect(shouldReloadNow({...base, idleMs: 2 * 60 * 1000})).toBe(true);
  });

  it('keeps a draft, a popup or a call', () => {
    expect(shouldReloadNow({...base, hidden: true, busy: true})).toBe(false);
  });

  it('does not loop when the build keeps differing', () => {
    expect(shouldReloadNow({...base, hidden: true, lastReloadAgoMs: 60 * 1000})).toBe(false);
  });
});
