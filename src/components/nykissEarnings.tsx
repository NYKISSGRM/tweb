// NYKISS: заработок и ранг/огонёк двумя нативными строками внутри обычного профиля (Настройки), сразу после «Имя пользователя».
// Нет ключа NYKISS или нет ответа: ничего не рендерим, профиль остаётся стоковым. Несовпадение Telegram-аккаунта блок не прячет:
// данные принадлежат тому, чей ключ подключён. Подробности у воркера в CRM-мини-аппке (пункт «NYKISS» в левом меню).
import {createMemo, createResource, Show} from 'solid-js';
import Row from '@components/rowTsx';
import {getKey} from '@lib/nykiss/quickBubble';
import {earningsRows} from '@lib/nykiss/profileModel';

export default function NykissEarnings() {
  const [profile] = createResource(async() => {
    if(!getKey()) return null;
    const {loadProfile} = await import('@lib/nykiss/profileData');
    return loadProfile();
  });
  const rows = createMemo(() => profile.state === 'ready' ? earningsRows(profile()) : null);

  return (
    <Show when={rows()}>
      {(r) => (
        <>
          <Show when={r().money}>
            {(m) => (
              <Row>
                <Row.Icon icon="wallet" />
                <Row.Title titleRight={<span dir="auto">{`${m().month} за месяц`}</span>} titleRightSecondary>
                  <span dir="auto">{`${m().today} сегодня`}</span>
                </Row.Title>
                <Row.Subtitle>
                  Заработок
                  <span class="sr-only">{`. ${m().aria}`}</span>
                </Row.Subtitle>
              </Row>
            )}
          </Show>
          <Show when={r().rank}>
            {(k) => (
              <Row>
                <Row.Icon icon="fire" />
                <Row.Title>
                  <span dir="auto" style={k().color ? {color: k().color} : undefined}>{k().name}</span>
                </Row.Title>
                <Show when={k().fire}>
                  <Row.Subtitle><span dir="auto">{k().fire}</span></Row.Subtitle>
                </Show>
              </Row>
            )}
          </Show>
        </>
      )}
    </Show>
  );
}
