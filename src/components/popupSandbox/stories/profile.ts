import {defineStories, type PopupStory} from '../registry';

type Story = Omit<PopupStory, 'group'>;
import type {PopupStoryContext} from '../context';

const LONG_ABOUT = Array.from({length: 14}, (_, i) => `Line ${i + 1}: a long profile description that has to wrap and scroll inside the window.`).join('\n') +
  '\nhttps://example.com/' + 'a-very-long-link-without-any-spaces-'.repeat(4);

const counters = () => [
  {_: 'messages.searchCounter', pFlags: {}, filter: {_: 'inputMessagesFilterPhotos'}, count: 1},
  {_: 'messages.searchCounter', pFlags: {}, filter: {_: 'inputMessagesFilterVideo'}, count: 0},
  {_: 'messages.searchCounter', pFlags: {}, filter: {_: 'inputMessagesFilterDocument'}, count: 12},
  {_: 'messages.searchCounter', pFlags: {}, filter: {_: 'inputMessagesFilterUrl'}, count: 157}
];

const stories: Story[] = ([
  ['user', 'private', 'Profile window: user', 'Designer. Writes about interfaces.'],
  ['bot', 'bot', 'Profile window: bot', '#1 CEX & SocialFi platform on Telegram. @sandbox_news is the news channel.'],
  ['channel', 'channel', 'Profile window: channel', 'News and releases of the sandbox.'],
  ['group', 'group', 'Profile window: group', 'A group for everyone who tests popups.'],
  ['longAbout', 'private', 'Profile window: long description', LONG_ABOUT]
] as const).map(([id, kind, title, about]) => ({
  id: `profile/${id}`,
  // a made-up description means nothing against a real account
  fixtureOnly: id === 'longAbout',
  title,
  managers: (ctx: PopupStoryContext) => {
    const peerId = ctx.peer(kind);
    const full = kind === 'private' || kind === 'bot' ?
      {_: 'userFull', pFlags: {}, id: peerId, about, settings: {_: 'peerSettings', pFlags: {}}, common_chats_count: 0, bot_info: kind === 'bot' ? {_: 'botInfo', pFlags: {}, user_id: peerId, description: about} : undefined} :
      {_: kind === 'group' ? 'chatFull' : 'channelFull', pFlags: {}, id: peerId.toChatId(), about};
    return {
      appProfileManager: {
        getProfileByPeerId: () => full,
        getProfile: () => full,
        getChatFull: () => full,
        getChannelFull: () => full
      },
      appMessagesManager: {
        getSearchCounters: () => counters()
      }
    };
  },
  open: async(ctx: PopupStoryContext) => {
    const {default: showProfilePopup} = await import('@components/popups/profile');
    showProfilePopup({peerId: ctx.peer(kind)});
  }
}));

defineStories('Profile', stories);
