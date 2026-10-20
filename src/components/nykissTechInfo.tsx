// NYKISS: technical rows in a user's profile, like AyuGram: ID (tap to copy), registration estimate, data center,
// number of common groups. Only for other users; every row hides itself when its data is missing.
import {Show} from 'solid-js';
import Row from '@components/rowTsx';
import {copyTextToClipboard} from '@helpers/clipboard';
import {useHotReloadGuard} from '@lib/solidjs/hotReloadGuard';
import {dcLabel, estimateRegistration} from '@lib/nykiss/techInfo';

export default function NykissTechInfo(props: {peerId: PeerId, dcId?: number, commonChats?: number}) {
  const {toastNew} = useHotReloadGuard();
  const id = () => String(props.peerId);
  const copyId = () => {
    copyTextToClipboard(id());
    toastNew({langPackKey: 'TextCopied'});
  };

  return (
    <>
      <Row clickable={copyId}>
        <Row.Icon icon="info" />
        <Row.Title><span dir="auto">{id()}</span></Row.Title>
        <Row.Subtitle>ID · нажми, чтобы скопировать</Row.Subtitle>
      </Row>
      <Row>
        <Row.Icon icon="calendar" />
        <Row.Title><span dir="auto">{estimateRegistration(Number(props.peerId))}</span></Row.Title>
        <Row.Subtitle>Регистрация (оценка по ID)</Row.Subtitle>
      </Row>
      <Show when={props.dcId}>
        <Row>
          <Row.Icon icon="cloud" />
          <Row.Title><span dir="auto">{dcLabel(props.dcId)}</span></Row.Title>
          <Row.Subtitle>Дата-центр</Row.Subtitle>
        </Row>
      </Show>
      <Show when={props.commonChats}>
        <Row>
          <Row.Icon icon="group" />
          <Row.Title><span dir="auto">{String(props.commonChats)}</span></Row.Title>
          <Row.Subtitle>Общих групп</Row.Subtitle>
        </Row>
      </Show>
    </>
  );
}
