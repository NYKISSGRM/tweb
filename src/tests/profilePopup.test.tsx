/*
 * The profile window: opening it, asking for the same profile twice, and closing it. The popup shell,
 * the profile body and everything the buttons reach for are replaced, so this looks only at the
 * window's own bookkeeping — which call opens one, which one is left alone, which one closes it.
 */

import {beforeEach, describe, expect, it, vi} from 'vitest';
import '@helpers/peerIdPolyfill';

const mocks = vi.hoisted(() => ({
  created: 0,
  popups: [] as {kind: symbol, hide: () => void}[],
  shown: [] as boolean[]
}));

vi.mock('@lib/langPack', () => ({i18n: (key: string) => key, default: {}}));
vi.mock('@lib/rootScope', () => ({default: {myId: 1, managers: {}}}));
vi.mock('@lib/appImManager', () => ({default: {}}));
vi.mock('@lib/solidjs/hotReloadGuardProvider', () => ({default: (): void => undefined}));
vi.mock('@components/peerProfile', () => ({renderPeerProfile: (): HTMLElement => document.createElement('div')}));
vi.mock('@components/iconTsx', () => ({IconTsx: (): any => <span />}));
vi.mock('@components/rowTsx', () => ({default: (): any => <div />}));
vi.mock('@components/section', () => ({default: (): any => <div />}));
vi.mock('@components/ripple', () => ({default: (): void => undefined}));
vi.mock('@components/buttonMenuToggle', () => ({default: ({container}: any): any => container}));
vi.mock('@components/confirmationPopup', () => ({default: (): Promise<void> => Promise.resolve()}));
vi.mock('@components/peerTitle', () => ({default: class {element = document.createElement('span');}}));
vi.mock('@components/popups/reportAd', () => ({showPeerReport: (): void => undefined}));
vi.mock('@components/toast', () => ({toastNew: (): void => undefined}));
vi.mock('@helpers/copyContact', () => ({copyTmeLink: (): void => undefined}));
vi.mock('@helpers/solid/subscribeOn', () => ({subscribeOn: (): (() => void) => (): void => undefined}));
vi.mock('@stores/fullPeers', () => ({useFullPeer: (): (() => void) => (): void => undefined}));
vi.mock('@stores/peers', () => ({usePeer: (): object => ({})}));
vi.mock('@appManagers/utils/peers/getPeerActiveUsernames', () => ({default: (): string[] => []}));

vi.mock('@components/popups/indexTsx', () => {
  const PopupElement = (props: any) => {
    mocks.popups.push({kind: props.kind, hide: () => props.onClose?.()});
    mocks.shown.push(props.show);
    return <div class={props.class}>{props.children}</div>;
  };
  PopupElement.CloseButton = () => <button />;
  PopupElement.Scrollable = (props: any) => <div>{props.children}</div>;
  // a closed popup leaves the list, like the real one once its animation is over
  PopupElement.getPopups = (kind: symbol) => mocks.popups.filter((popup) => popup.kind === kind).map((popup) => ({
    hide: () => {
      popup.hide();
      mocks.popups.splice(mocks.popups.indexOf(popup), 1);
    }
  }));

  return {
    default: PopupElement,
    PopupContext: {},
    createPopup: (factory: () => any) => {
      ++mocks.created;
      factory();
    }
  };
});

import showProfilePopup, {getProfileCounterRows, hideProfilePopup, toggleProfilePopup} from '@components/popups/profile';

const PEER = (100).toPeerId();
const OTHER = (200).toPeerId();

describe('profile popup', () => {
  beforeEach(() => {
    hideProfilePopup();
    mocks.created = 0;
    mocks.popups.length = 0;
  });

  it('opens a window', () => {
    showProfilePopup({peerId: PEER});
    expect(mocks.created).toBe(1);
  });

  it('leaves a repeated call for the same profile alone', () => {
    showProfilePopup({peerId: PEER});
    showProfilePopup({peerId: PEER});
    expect(mocks.created).toBe(1);
  });

  it('lets another peer replace the open window', () => {
    showProfilePopup({peerId: PEER});
    showProfilePopup({peerId: OTHER});
    expect(mocks.created).toBe(2);
    expect(mocks.popups.length).toBe(1);
  });

  it('closes on the second toggle and opens again on the third', () => {
    toggleProfilePopup({peerId: PEER});
    toggleProfilePopup({peerId: PEER});
    expect(mocks.popups.length).toBe(0);
    toggleProfilePopup({peerId: PEER});
    expect(mocks.created).toBe(2);
  });

  it('shows a counter row only for what exists', () => {
    expect(getProfileCounterRows({photos: 1, videos: 0, files: 0, links: 157}).map((row) => [row.type, row.key, row.count])).toEqual([
      ['media', 'Photos', 1],
      ['links', 'Links', 157]
    ]);
    expect(getProfileCounterRows({photos: 2, videos: 3})[0]).toMatchObject({key: 'MediaFiles', count: 5});
    expect(getProfileCounterRows({})).toEqual([]);
  });
});
