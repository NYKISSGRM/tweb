import {SliderSuperTab} from '@components/slider';

// NYKISS — встроенный «сайт» (мини-апп воркера в режиме ?embed=1, без нижней навигации).
// Открывается пунктом меню в левом сайдбаре; живёт в обычном табе-слайдере с кнопкой «назад».
const NYKISS_WEB_URL = 'https://wcrm.206.71.148.212.nip.io/?embed=1';

export default class AppNykissWebTab extends SliderSuperTab {
  public init() {
    this.container.classList.add('nykiss-web-tab');
    this.title.textContent = 'NYKISS'; // бренд, без langpack-ключа

    // Контент — на всю высоту, iframe тянется флексом.
    this.content.style.display = 'flex';
    this.content.style.flexDirection = 'column';
    this.content.style.height = '100%';

    const iframe = document.createElement('iframe');
    iframe.src = NYKISS_WEB_URL;
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write; camera; microphone; fullscreen');
    iframe.style.cssText = 'flex:1 1 auto;width:100%;height:100%;border:0;display:block;background:#070807;';
    this.content.append(iframe);
  }
}
