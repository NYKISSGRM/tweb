import {beforeEach, describe, expect, it} from 'vitest';
import alignFolderPanes from '@lib/nykiss/folderPanes';

const pane = (id: string, active = false) => {
  const el = document.createElement('div');
  el.id = id;
  if(active) el.classList.add('active');
  return el;
};

describe('alignFolderPanes', () => {
  let container: HTMLElement;
  let all: HTMLElement, hot: HTMLElement, personal: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    // the broken start: «Все» landed last and the first pane is shown under the «Все» tab
    all = pane('all');
    hot = pane('hot', true);
    personal = pane('personal');
    container.append(hot, personal, all);
  });

  it('puts the panes in the order of the tabs and shows the pane of the selected tab', () => {
    expect(alignFolderPanes(container, [all, hot, personal], all)).toBe(true);
    expect([...container.children].map((el) => el.id)).toEqual(['all', 'hot', 'personal']);
    expect([...container.children].map((el) => el.classList.contains('active'))).toEqual([true, false, false]);
  });

  it('does nothing when everything already matches', () => {
    alignFolderPanes(container, [all, hot, personal], all);
    expect(alignFolderPanes(container, [all, hot, personal], all)).toBe(false);
  });

  it('follows another selected tab', () => {
    alignFolderPanes(container, [all, hot, personal], all);
    alignFolderPanes(container, [all, hot, personal], personal);
    expect(personal.classList.contains('active')).toBe(true);
    expect(all.classList.contains('active')).toBe(false);
  });

  it('leaves the classes to a running switch animation', () => {
    hot.classList.add('slide-left');
    expect(alignFolderPanes(container, [all, hot, personal], all)).toBe(false);
    expect([...container.children].map((el) => el.id)).toEqual(['hot', 'personal', 'all']);
  });

  it('does nothing without a shown pane or any panes', () => {
    expect(alignFolderPanes(container, [all, hot, personal], undefined)).toBe(false);
    expect(alignFolderPanes(container, [], all)).toBe(false);
  });
});
