import type ChatInput from '@components/chat/input';
import AutocompleteHelperController from '@components/chat/autocompleteHelperController';
import AutocompletePeerHelper from '@components/chat/autocompletePeerHelper';
import hideCommandAutocomplete from '@components/chat/hideCommandAutocomplete';
import {AppManagers} from '@lib/managers';
import rootScope from '@lib/rootScope';
import {filterQuickReplies} from '@lib/nykiss/quickReplies';

// NYKISS Gram: "/" in a private chat lists the account's Telegram Business quick replies (Premium); a pick sends the shortcut.
export default class QuickRepliesHelper extends AutocompletePeerHelper {
  constructor(
    appendTo: HTMLElement,
    controller: AutocompleteHelperController,
    chatInput: ChatInput,
    private managers: AppManagers
  ) {
    super(appendTo,
      controller,
      'quick-replies-helper',
      (target) => {
        const shortcutId = +(target as HTMLElement).dataset.shortcutId;
        if(!shortcutId) {
          return;
        }

        hideCommandAutocomplete(controller);
        return chatInput.getReadyToSend(() => {
          chatInput.clearInput();
          this.managers.appBusinessManager.sendQuickReply(chatInput.chat.peerId, shortcutId).catch((err) => {
            console.error('quick reply send failed', err);
          });
        });
      },
      'PremiumBusinessQuickReplies'
    );
  }

  public async checkQuery(query: string, peerId: PeerId) {
    if(!rootScope.premium || !peerId.isUser() || peerId === rootScope.myId) {
      return false;
    }

    if(await this.managers.appUsersManager.isBot(peerId)) {
      return false;
    }

    const found = filterQuickReplies(await this.managers.appBusinessManager.getQuickReplies(), query);
    if(!found.length) {
      return false;
    }

    const middleware = this.controller.getMiddleware();
    if(!middleware()) {
      return false;
    }

    this.render(found.map((item) => ({
      peerId: rootScope.myId,
      name: '/' + item.shortcut,
      description: item.preview
    })), middleware);
    // the list is built by the base class from the data above; tag the rows with their shortcut ids, in the same order
    Array.from(this.list.children).forEach((row, idx) => {
      (row as HTMLElement).dataset.shortcutId = '' + found[idx].id;
    });
    return true;
  }
}
