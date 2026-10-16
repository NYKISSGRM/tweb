// NYKISS: коллега в профиле: заработок и ранг/огонёк нативными строками после «Имя пользователя».
// Не воркер команды, нет ключа NYKISS или нет ответа: ничего не рендерим, профиль остаётся стоковым.
// Сервер отдаёт то, что команда и так видит в рейтинге: баланса к выводу, ключей и мамонтов тут нет.
import {createResource, Show} from 'solid-js';
import Row from '@components/rowTsx';
import {getKey, lookupPeer} from '@lib/nykiss/quickBubble';
import {fmtMoney, daysWord} from '@lib/nykiss/profileModel';

export default function NykissColleague(props: {peerId: PeerId, username?: string}) {
  const [info] = createResource(() => props.peerId, async(peerId) => {
    if(!getKey()) return null;
    try {
      const b = await lookupPeer(Number(peerId), props.username);
      return b?.teammate || null;
    } catch(e) {
      return null;
    }
  });

  const color = () => /^#[0-9a-f]{3,8}$/i.test(info()?.rank_color || '') ? info().rank_color : undefined;
  const fire = () => Math.max(0, Math.floor(Number(info()?.flame_len) || 0));

  return (
    <Show when={info.state === 'ready' && info()}>
      {(t) => (
        <>
          <Row>
            <Row.Icon icon="wallet" />
            <Row.Title><span dir="auto">{fmtMoney(Number(t().total_earned) || 0)}</span></Row.Title>
            <Row.Subtitle>Заработок в NYKISS за всё время</Row.Subtitle>
          </Row>
          <Row>
            <Row.Icon icon="fire" />
            <Row.Title>
              <span dir="auto" style={color() ? {color: color()} : undefined}>{`${t().rank_emoji || ''} ${t().rank_name || ''}`.trim()}</span>
            </Row.Title>
            <Show when={fire()}>
              <Row.Subtitle><span dir="auto">{`Огонёк: ${fire()} ${daysWord(fire())}`}</span></Row.Subtitle>
            </Show>
          </Row>
        </>
      )}
    </Show>
  );
}
