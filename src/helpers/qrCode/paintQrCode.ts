import pause from '@helpers/schedulers/pause';
import textToSvgURL from '@helpers/textToSvgURL';

/**
 * Builds a Telegram-styled QR canvas for `data` using the supplied palette.
 * Shared between the auth-flow `SignQRCard` and the in-app "My QR code" popup.
 *
 * The host element receives the canvas as its last child; existing children
 * (e.g. a preloader) are left in place so the caller can decide when to fade
 * them out, mirroring the legacy `SignQRCard` behaviour.
 *
 * Returns a teardown that strips every QR canvas this call appended, so the
 * caller can reset the host before repainting (e.g. on theme change).
 */
export type PaintQrOptions = {
  data: string;
  size: number;
  host: HTMLElement;
  /** Backdrop color behind the dots (usually the QR card surface color). */
  background: string;
  /** Dot color — the "ink" of the QR code. */
  foreground: string;
  /** Color used to tint the embedded Telegram logo. */
  logoColor: string;
  /**
   * Device-pixel multiplier for the rendered QR bitmap. Defaults to the screen
   * DPR. The My QR popup passes max(screenDPR, 3) so the QR stays crisp in its
   * 3×-scale (1170×2532) export PNG even on 1×/2× displays.
   */
  pixelRatio?: number;
  /**
   * Class added to the QR canvas the instant it's appended — before the draw
   * race is awaited — so the canvas is already correctly sized while qr-code-
   * styling finishes loading the logo (the auth `SignQRCard` reveal relies on
   * the canvas filling its container during that window).
   */
  canvasClass?: string;
  /** Already-loaded `qr-code-styling` constructor; loaded lazily by the caller. */
  QRCodeStylingCtor: any;
};

// NYKISS Gram puts its gold "N" monogram in the QR centre instead of the
// Telegram paper plane. Same N stroke as the login card (SignInCard), tinted
// with the QR's logoColor. Cached per colour so we build the data URL once.
const logoUrlCache = new Map<string, Promise<string>>();
function getLogoUrl(logoColor: string): Promise<string> {
  let url = logoUrlCache.get(logoColor);
  if(!url) {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">' +
      `<path d="M40 124V36L120 124V36" fill="none" stroke="${logoColor}" ` +
      'stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    url = Promise.resolve(textToSvgURL(svg));
    logoUrlCache.set(logoColor, url);
  }
  return url;
}

export async function paintQrCode(options: PaintQrOptions) {
  const {data, size, host, background, foreground, logoColor, pixelRatio = window.devicePixelRatio, QRCodeStylingCtor} = options;

  const logoUrl = await getLogoUrl(logoColor);

  const qrCode = new QRCodeStylingCtor({
    width: size * pixelRatio,
    height: size * pixelRatio,
    data,
    image: logoUrl,
    dotsOptions: {color: foreground, type: 'rounded'},
    cornersSquareOptions: {type: 'extra-rounded', color: foreground},
    imageOptions: {imageSize: 1, margin: 0},
    backgroundOptions: {color: background},
    qrOptions: {errorCorrectionLevel: 'L'}
  });

  qrCode.append(host);
  const canvas = host.lastChild as HTMLCanvasElement;
  if(options.canvasClass) canvas.classList.add(options.canvasClass);

  // qr-code-styling races the image-load against a 1s upper bound — matches the
  // legacy behaviour so we don't leave the host stuck behind a never-loading logo.
  let drawingPromise: Promise<void>;
  const internalDrawingPromise = qrCode._drawingPromise || qrCode._canvasDrawingPromise;
  if(internalDrawingPromise) {
    drawingPromise = internalDrawingPromise;
  } else {
    const image = qrCode._canvas?._image;
    drawingPromise = Promise.race([
      pause(1000),
      new Promise<void>((resolve) => {
        if(!image || image.complete) {
          window.requestAnimationFrame(() => resolve());
          return;
        }

        image.addEventListener('load', () => {
          window.requestAnimationFrame(() => resolve());
        }, {once: true});
      })
    ]);
  }
  await drawingPromise;

  return {canvas, qrCode};
}

/**
 * Builds the public `t.me/<username>` link encoded in a user's QR code (the
 * "My QR code" popup). Kept beside `paintQrCode` so the QR callers share one
 * place for the link shape.
 */
export function buildTelegramUserQrUrl(username: string) {
  return `https://t.me/${username}`;
}
