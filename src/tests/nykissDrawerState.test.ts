import {describe, expect, it} from 'vitest';
import {
  ensureDrawerScrim,
  formatAccountCounter,
  getAccountCounter,
  getDrawerSubtitle,
  readAccountsCollapsed,
  setDrawerBackgroundInert,
  writeAccountsCollapsed
} from '@lib/nykiss/drawerState';

describe('drawer header subtitle', () => {
  it('prefers the active username, then the plain one, then the phone', () => {
    expect(getDrawerSubtitle({usernames: [{username: 'old'}, {username: 'main', pFlags: {active: true}}], username: 'x'})).toBe('@main');
    expect(getDrawerSubtitle({username: 'plain', phone: '123'})).toBe('@plain');
    expect(getDrawerSubtitle({phone: '48123'}, (phone) => '+' + phone.slice(0, 2))).toBe('+48');
    expect(getDrawerSubtitle({})).toBeUndefined();
    expect(getDrawerSubtitle(undefined)).toBeUndefined();
  });
});

describe('account counters', () => {
  it('draws no counter when there is nothing waiting', () => {
    expect(getAccountCounter({2: 0, 3: 5}, 2)).toBeUndefined();
    expect(getAccountCounter({3: 5}, 4)).toBeUndefined();
    expect(getAccountCounter(undefined, 1)).toBeUndefined();
    expect(getAccountCounter({3: 5}, 3)).toBe(5);
  });

  it('caps the pill text', () => {
    expect(formatAccountCounter(7)).toBe('7');
    expect(formatAccountCounter(100)).toBe('99+');
  });
});

describe('accounts folded state', () => {
  it('round-trips through storage and survives a broken one', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k)
    };
    expect(readAccountsCollapsed(storage)).toBe(false);
    writeAccountsCollapsed(true, storage);
    expect(readAccountsCollapsed(storage)).toBe(true);
    writeAccountsCollapsed(false, storage);
    expect(readAccountsCollapsed(storage)).toBe(false);
    const broken = {getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => {}};
    expect(readAccountsCollapsed(broken)).toBe(false);
    expect(() => writeAccountsCollapsed(true, broken)).not.toThrow();
  });
});

describe('drawer scrim and background', () => {
  it('puts the scrim before the menu and reuses it', () => {
    const host = document.createElement('div');
    const menu = document.createElement('div');
    host.append(menu);
    let clicks = 0;
    const scrim = ensureDrawerScrim(undefined, menu, () => clicks++);
    expect(menu.previousElementSibling).toBe(scrim);
    scrim.click();
    expect(clicks).toBe(1);
    expect(ensureDrawerScrim(scrim, menu, () => {})).toBe(scrim);
    expect(host.querySelectorAll('.btn-menu-drawer-scrim').length).toBe(1);
  });

  it('makes the center column inert and back', () => {
    const column = document.createElement('div');
    column.id = 'column-center';
    document.body.append(column);
    setDrawerBackgroundInert(true);
    expect(column.hasAttribute('inert')).toBe(true);
    setDrawerBackgroundInert(false);
    expect(column.hasAttribute('inert')).toBe(false);
    column.remove();
    expect(() => setDrawerBackgroundInert(true)).not.toThrow();
  });
});
