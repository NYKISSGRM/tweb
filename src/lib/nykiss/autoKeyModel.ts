// NYKISS: pure helper for the automatic sign-in (no Telegram or DOM imports, so it can be tested alone).

/** tgWebAppData from the web view link Telegram returns (it sits in the URL fragment). */
export function extractInitData(url: string): string | undefined {
  try {
    const hash = new URL(url).hash.replace(/^#/, '');
    return new URLSearchParams(hash).get('tgWebAppData') || undefined;
  } catch{
    return undefined;
  }
}
