// NYKISS — обмен ключа Gram на JWT мини-аппы воркера (POST /auth/gram).
// Токены живут ТОЛЬКО в памяти модуля, в localStorage их нет.

import {API, getKey, setKey} from '@lib/nykiss/quickBubble';

export type GramSession = {access: string, refresh: string};
export type GramAuthErrorCode = 'no-key' | 'bad-key' | 'forbidden' | 'rate-limit' | 'network';

export class GramAuthError extends Error {
  constructor(public code: GramAuthErrorCode, public detail?: string) {
    super(code);
  }
}

// Повторные запросы (nk:ready от iframe при ошибке) не чаще раза в THROTTLE_MS:
// в окне отдаём прошлый результат (сессию или ошибку), сеть не трогаем.
const THROTTLE_MS = 3000;

let session: GramSession | null = null;
let inflight: Promise<GramSession> | null = null;
let lastAt = 0;
let lastError: GramAuthError | null = null;

// Новая попытка по явному действию пользователя (открыл раздел, «Повторить», вставил ключ).
export function resetGramThrottle() {
  lastAt = 0;
  lastError = null;
}

async function request(): Promise<GramSession> {
  const key = getKey();
  if(!key) throw new GramAuthError('no-key');

  let res: Response;
  try {
    res = await fetch(API + '/auth/gram', {method: 'POST', headers: {'X-NYKISS-Key': key}});
  } catch(e) {
    throw new GramAuthError('network');
  }

  if(res.status === 401) {
    setKey('');
    throw new GramAuthError('bad-key');
  }
  if(res.status === 403) {
    let detail = '';
    try { detail = (await res.json())?.detail || ''; } catch(e) {}
    throw new GramAuthError('forbidden', String(detail));
  }
  if(res.status === 429) throw new GramAuthError('rate-limit');
  if(!res.ok) throw new GramAuthError('network');

  let body: any;
  try { body = await res.json(); } catch(e) { throw new GramAuthError('network'); }
  if(!body || typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
    throw new GramAuthError('network');
  }
  return {access: body.access_token, refresh: body.refresh_token};
}

export function getGramSession(): Promise<GramSession> {
  if(inflight) return inflight;

  if(Date.now() - lastAt < THROTTLE_MS) {
    if(lastError) return Promise.reject(lastError);
    if(session) return Promise.resolve(session);
  }

  const p = request().then((s) => {
    session = s;
    lastError = null;
    return s;
  }, (e) => {
    session = null;
    lastError = e instanceof GramAuthError ? e : new GramAuthError('network');
    throw lastError;
  }).finally(() => {
    lastAt = Date.now();
    inflight = null;
  });
  inflight = p;
  return p;
}
