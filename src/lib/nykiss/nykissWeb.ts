// NYKISS — встроенный «сайт» (мини-апп воркера в режиме ?embed=1, без нижней навигации).
// Открывается пунктом меню в левом сайдбаре НА ВЕСЬ ЭКРАН (а не в узком слайдере ~420px,
// где CRM была тесной и «не работала»). Ванильный оверлей, как quickBubble.ts.

const NYKISS_WEB_URL = 'https://wcrm.206.71.148.212.nip.io/?embed=1';

let overlay: HTMLDivElement | null = null;
let onKeyDown: ((e: KeyboardEvent) => void) | null = null;

export function closeNykissWeb() {
  if(onKeyDown) {
    document.removeEventListener('keydown', onKeyDown);
    onKeyDown = null;
  }
  if(overlay) {
    overlay.remove();
    overlay = null;
  }
}

export function openNykissWeb() {
  if(overlay) return; // уже открыт

  overlay = document.createElement('div');
  overlay.className = 'nykiss-web-overlay';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:100000',
    'display:flex', 'flex-direction:column',
    'background:#070807'
  ].join(';');

  // Кнопка «назад/закрыть» — золотой круг, поверх iframe, с учётом вырезов.
  const back = document.createElement('button');
  back.setAttribute('aria-label', 'Закрыть NYKISS');
  back.style.cssText = [
    'position:absolute',
    'top:calc(env(safe-area-inset-top, 0px) + 12px)',
    'left:calc(env(safe-area-inset-left, 0px) + 12px)',
    'z-index:2',
    'width:40px', 'height:40px', 'border:0', 'border-radius:50%',
    'cursor:pointer',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(10,12,10,0.72)',
    'backdrop-filter:blur(8px)', '-webkit-backdrop-filter:blur(8px)',
    'box-shadow:0 2px 10px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(216,180,81,0.45)',
    'color:#e9c860'
  ].join(';');
  back.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  back.addEventListener('click', closeNykissWeb);

  const iframe = document.createElement('iframe');
  iframe.src = NYKISS_WEB_URL;
  iframe.setAttribute('allow', 'clipboard-read; clipboard-write; camera; microphone; fullscreen');
  iframe.style.cssText = 'flex:1 1 auto;width:100%;height:100%;border:0;display:block;background:#070807;';

  overlay.append(iframe, back);
  document.body.append(overlay);

  onKeyDown = (e: KeyboardEvent) => {
    if(e.key === 'Escape') closeNykissWeb();
  };
  document.addEventListener('keydown', onKeyDown);
}
