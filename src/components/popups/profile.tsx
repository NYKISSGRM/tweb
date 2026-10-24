import {createMemo, createResource, createSignal, For, JSX, Show, useContext} from 'solid-js';
import {MessagesFilter, UserFull} from '@layer';
import PopupElement, {createPopup, PopupContext} from '@components/popups/indexTsx';
import {renderPeerProfile} from '@components/peerProfile';
import HotReloadGuard from '@lib/solidjs/hotReloadGuardProvider';
import {IconTsx} from '@components/iconTsx';
import Row from '@components/rowTsx';
import Section from '@components/section';
import ripple from '@components/ripple';
import ButtonMenuToggle from '@components/buttonMenuToggle';
import type {ButtonMenuItemOptionsVerifiable} from '@components/buttonMenu';
import confirmationPopup from '@components/confirmationPopup';
import {showPeerReport} from '@components/popups/reportAd';
import {toastNew} from '@components/toast';
import {NULL_PEER_ID} from '@appManagers/constants';
import getPeerActiveUsernames from '@appManagers/utils/peers/getPeerActiveUsernames';
import appImManager from '@lib/appImManager';
import rootScope from '@lib/rootScope';
import PeerTitle from '@components/peerTitle';
import {i18n, LangPackKey} from '@lib/langPack';
import {useFullPeer} from '@stores/fullPeers';
import {usePeer} from '@stores/peers';
import {subscribeOn} from '@helpers/solid/subscribeOn';
import {copyTmeLink} from '@helpers/copyContact';

export type ProfilePopupOptions = {
  peerId: PeerId,
  threadId?: number,
  /**
   * What the "More" button opens. The chat header hands over its own menu, so the profile offers
   * the same actions; without it the button falls back to the few that make sense on their own.
   */
  moreButtons?: () => ButtonMenuItemOptionsVerifiable[]
};

export const PROFILE_POPUP_KIND = Symbol('profile-popup');

type Opened = {peerId: PeerId, threadId?: number, hide: () => void};
let current: Opened | undefined;

/** Closes the profile popup, if one is open. */
export function hideProfilePopup() {
  PopupElement.getPopups(PROFILE_POPUP_KIND).forEach((popup) => popup.hide());
}

/** A second click on the same chat header closes the profile; any other peer swaps it. */
export function toggleProfilePopup(options: ProfilePopupOptions) {
  if(current && current.peerId === options.peerId && current.threadId === options.threadId) {
    hideProfilePopup();
    return;
  }

  showProfilePopup(options);
}

const COUNTER_FILTERS: MessagesFilter[] = [
  {_: 'inputMessagesFilterPhotos'},
  {_: 'inputMessagesFilterVideo'},
  {_: 'inputMessagesFilterDocument'},
  {_: 'inputMessagesFilterUrl'}
];

export type ProfileCounterType = 'members' | 'media' | 'files' | 'links';

type CounterRow = {
  type: ProfileCounterType,
  icon: Icon,
  key: LangPackKey,
  count: number
};

/** The rows under the open-app button. A kind with nothing in it gets no row. */
export function getProfileCounterRows(counts: {members?: number, photos?: number, videos?: number, files?: number, links?: number}): CounterRow[] {
  const photos = counts.photos || 0;
  const videos = counts.videos || 0;
  const rows: CounterRow[] = [];
  if(counts.members) {
    rows.push({type: 'members', icon: 'group', key: 'Members', count: counts.members});
  }

  if(photos + videos) {
    rows.push({
      type: 'media',
      icon: 'image',
      key: videos ? 'MediaFiles' : 'Photos',
      count: photos + videos
    });
  }

  if(counts.files) {
    rows.push({type: 'files', icon: 'document', key: 'Files', count: counts.files});
  }

  if(counts.links) {
    rows.push({type: 'links', icon: 'link', key: 'Links', count: counts.links});
  }

  return rows;
}

async function openSharedMedia(peerId: PeerId, threadId: number | undefined, type: ProfileCounterType) {
  // the column's media tab belongs to the chat that is open
  if(appImManager.chat?.peerId !== peerId) {
    await appImManager.setPeer({peerId, threadId});
  }

  const {default: appSidebarRight} = await import('@components/sidebarRight');
  appSidebarRight.toggleSidebar(true);
  appSidebarRight.sharedMediaTab.setSearchTab(type);
}

function ActionButton(props: {
  icon: Icon,
  label: JSX.Element,
  onClick?: () => void,
  ref?: (el: HTMLButtonElement) => void
}) {
  return (
    <button
      type="button"
      class="profile-popup-action"
      onClick={() => props.onClick?.()}
      ref={(el) => {
        ripple(el);
        props.ref?.(el);
      }}
    >
      <IconTsx icon={props.icon} />
      <span class="profile-popup-action-label">{props.label}</span>
    </button>
  );
}

function Actions(props: {options: ProfilePopupOptions}) {
  const popup = useContext(PopupContext);
  const {peerId, threadId} = props.options;
  const isMe = peerId === rootScope.myId;
  const peer = usePeer(peerId);
  const fullPeer = useFullPeer(peerId);

  const [muted, {refetch}] = createResource(() => {
    return rootScope.managers.appNotificationsManager.isPeerLocalMuted({peerId, threadId, respectType: false});
  });
  subscribeOn(rootScope)('dialog_notify_settings', (dialog) => {
    if(dialog.peerId === peerId) refetch();
  });

  const username = createMemo(() => getPeerActiveUsernames(peer as any)[0]);

  const fallbackButtons = (): ButtonMenuItemOptionsVerifiable[] => [{
    icon: 'copy',
    text: 'Text.CopyLabel_ShareLink',
    onClick: () => copyTmeLink(username()),
    verify: () => !!username()
  }, {
    icon: 'flag',
    text: 'ReportChat',
    onClick: () => {
      popup.hide();
      showPeerReport(peerId);
    },
    verify: () => !isMe
  }, {
    icon: 'stop',
    text: 'BlockUser',
    onClick: () => blockPeer(peerId, popup.hide),
    verify: () => peerId.isUser() && !isMe && !(peer as any)?.pFlags?.bot && !(fullPeer() as UserFull.userFull)?.pFlags?.blocked
  }, {
    icon: 'adduser',
    text: 'Unblock',
    onClick: () => rootScope.managers.appUsersManager.toggleBlock(peerId, false),
    verify: () => peerId.isUser() && !isMe && !!(fullPeer() as UserFull.userFull)?.pFlags?.blocked
  }];

  const buttons = (): ButtonMenuItemOptionsVerifiable[] => {
    const given = props.options.moreButtons?.();
    if(!given?.length) return fallbackButtons();
    // an action of the chat's own menu leaves the profile first, so it does not open under it
    return given.map((button) => ({
      ...button,
      onClick: (e: any) => {
        popup.hide();
        return button.onClick?.(e);
      }
    }));
  };

  const moreToggle = (
    <button type="button" class="profile-popup-action" ref={(el) => ripple(el)}>
      <IconTsx icon="more" />
      <span class="profile-popup-action-label">{i18n('MultiAccount.More')}</span>
    </button>
  ) as HTMLElement;
  const toggle = ButtonMenuToggle({
    container: moreToggle,
    direction: 'bottom-left',
    buttons: buttons(),
    buttonOptions: {ariaLabel: 'MultiAccount.More'}
  });

  return (
    <div class="profile-popup-actions">
      <ActionButton
        icon="message"
        label={i18n('Message')}
        onClick={() => {
          popup.hide();
          appImManager.setPeer({peerId, threadId});
        }}
      />
      <Show when={!isMe}>
        <ActionButton
          icon={muted() ? 'unmute' : 'mute'}
          label={i18n(muted() ? 'ChatList.Context.Unmute' : 'ChatList.Context.Mute')}
          onClick={() => {
            rootScope.managers.appMessagesManager.togglePeerMute({peerId, threadId, mute: !muted()});
          }}
        />
      </Show>
      {toggle}
    </div>
  );
}

async function blockPeer(peerId: PeerId, hide: () => void) {
  try {
    await confirmationPopup({
      peerId,
      titleLangKey: 'BlockUser',
      descriptionLangKey: 'AreYouSureBlockContact2',
      descriptionLangArgs: [new PeerTitle({peerId}).element],
      button: {langKey: 'BlockUser', isDanger: true}
    });
  } catch{
    return;
  }

  await rootScope.managers.appUsersManager.toggleBlock(peerId, true);
  toastNew({langPackKey: 'UserBlocked'});
  hide();
}

function Counters(props: {options: ProfilePopupOptions}) {
  const popup = useContext(PopupContext);
  const {peerId, threadId} = props.options;
  const peer = usePeer(peerId);
  // a channel's subscribers are not a list anyone can open
  const members = () => peerId.isAnyChat() && !(peer as any)?.pFlags?.broadcast ? (peer as any)?.participants_count : undefined;

  const [rows] = createResource(async() => {
    try {
      const counters = await rootScope.managers.appMessagesManager.getSearchCounters(peerId, COUNTER_FILTERS, true, threadId);
      const count = (filter: MessagesFilter['_']) => counters.find((counter) => counter.filter._ === filter)?.count;
      return getProfileCounterRows({
        photos: count('inputMessagesFilterPhotos'),
        videos: count('inputMessagesFilterVideo'),
        files: count('inputMessagesFilterDocument'),
        links: count('inputMessagesFilterUrl')
      });
    } catch{
      // a restricted peer has no counters; the profile is complete without them
      return [] as CounterRow[];
    }
  });

  const allRows = () => [...getProfileCounterRows({members: members()}), ...(rows() || [])];

  return (
    <Show when={allRows().length}>
      <Section noDelimiter class="profile-popup-counters">
        <For each={allRows()}>
          {(row) => (
            <Row
              clickable={() => {
                popup.hide();
                openSharedMedia(peerId, threadId, row.type);
              }}
            >
              <Row.Icon icon={row.icon} />
              <Row.Title>{i18n(row.key, [row.count])}</Row.Title>
            </Row>
          )}
        </For>
      </Section>
    </Show>
  );
}

function StopAndBlock(props: {options: ProfilePopupOptions}) {
  const popup = useContext(PopupContext);
  const {peerId} = props.options;
  const peer = usePeer(peerId);
  const fullPeer = useFullPeer(peerId);
  const isBot = () => !!(peer as any)?.pFlags?.bot;
  const blocked = () => !!(fullPeer() as UserFull.userFull)?.pFlags?.blocked;

  return (
    <Show when={isBot() && peerId !== rootScope.myId}>
      <Row
        color="danger"
        clickable={() => {
          if(blocked()) {
            rootScope.managers.appUsersManager.toggleBlock(peerId, false);
          } else {
            blockPeer(peerId, popup.hide);
          }
        }}
      >
        <Row.Icon icon={blocked() ? 'rotate' : 'hand'} />
        <Row.Title>{i18n(blocked() ? 'BotRestart' : 'BotStop')}</Row.Title>
      </Row>
    </Show>
  );
}

export default function showProfilePopup(options: ProfilePopupOptions): void {
  const {peerId, threadId} = options;
  if(!peerId || peerId === NULL_PEER_ID) return;

  // the same profile is already up: a repeated call leaves it be
  if(current && current.peerId === peerId && current.threadId === threadId) return;

  // another peer's profile gives way instead of stacking
  hideProfilePopup();

  const [show, setShow] = createSignal(true);
  const opened: Opened = {peerId, threadId, hide: () => setShow(false)};
  current = opened;

  function Inner() {
    const profile = renderPeerProfile({
      peerId,
      threadId,
      isDialog: true,
      popup: {
        actions: <Actions options={options} />,
        counters: <Counters options={options} />,
        footer: <StopAndBlock options={options} />
      }
    }, HotReloadGuard);

    return (
      <>
        <PopupElement.CloseButton class="profile-popup-close" />
        <PopupElement.Scrollable class="profile-popup-scrollable">
          {profile}
        </PopupElement.Scrollable>
      </>
    );
  }

  createPopup(() => (
    <PopupElement
      class="popup-peer-profile"
      show={show()}
      kind={PROFILE_POPUP_KIND}
      onClose={() => {
        if(current === opened) current = undefined;
      }}
    >
      <Inner />
    </PopupElement>
  ));
}
