// NYKISS: заработок и ранг/огонёк двумя нативными строками внутри обычного профиля (Настройки), сразу после «Имя пользователя».
// Нет ключа NYKISS, нет ответа, чужой Telegram-аккаунт: ничего не рендерим, профиль остаётся стоковым.
import {createMemo, createResource, Show} from 'solid-js';
import Row from '@components/rowTsx';
import {getKey} from '@lib/nykiss/quickBubble';
import {isIdentityMismatch} from '@lib/nykiss/team';
import {earningsRows} from '@lib/nykiss/profileModel';

export default function NykissEarnings() {
  const [profile] = createResource(async() => {
    if(!getKey()) return null;
    const {loadProfile} = await import('@lib/nykiss/profile');
    return loadProfile();
  });
  const rows = createMemo(() => profile.state === 'ready' && !isIdentityMismatch() ? earningsRows(profile()) : null);
  const openDetails = () => {
    import('@lib/nykiss/profile').then(({openMyProfile}) => openMyProfile());
  };

  return (
    <Show when={rows()}>
      {(r) => (
        <>
          <Show when={r().money}>
            {(m) => (
              <Row clickable={openDetails}>
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
              <Row clickable={openDetails}>
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
