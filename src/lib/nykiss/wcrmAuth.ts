// NYKISS — exchange of the Gram key for the worker mini app's JWT (POST /auth/gram).
// The tokens live ONLY in this module's memory: never in localStorage, never in logs.

import {API, getKey, setKey, fetchTimeout} from '@lib/nykiss/quickBubble';

export type GramSession = {access: string, refresh: string};
export type GramAuthErrorCode = 'no-key' | 'bad-key' | 'forbidden' | 'rate-limit' | 'network';

export class GramAuthError extends Error {
  constructor(public code: GramAuthErrorCode, public detail?: string) {
    super(code);
  }
}

// Repeated asks (nk:ready from the iframe after a failure) hit the network at most once per THROTTLE_MS:
// inside the window the previous outcome (session or error) is handed back.
const THROTTLE_MS = 3000;

let session: GramSession | null = null;
let inflight: Promise<GramSession> | null = null;
let lastAt = 0;
let lastError: GramAuthError | null = null;
let epoch = 0; // bumped on close: an answer that arrives after it must not put the tokens back

// A fresh attempt on an explicit user action (opened the section, «Повторить», pasted a key).
export function resetGramThrottle() {
  lastAt = 0;
  lastError = null;
}

// Forget the tokens (the section was closed): they are not kept around longer than the iframe needs them.
export function clearGramSession() {
  epoch++;
  session = null;
  resetGramThrottle();
}

async function request(): Promise<GramSession> {
  const key = getKey();
  if(!key) throw new GramAuthError('no-key');

  let res: Response;
  try {
    res = await fetchTimeout(API + '/auth/gram', {
      method: 'POST',
      headers: {'X-NYKISS-Key': key},
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer'
    });
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
  if(!res.ok) throw new GramAuthError('network'); // 5xx and the rest: "try again"

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

  const ep = epoch;
  const p = request().then((s) => {
    if(ep === epoch) {
      session = s;
      lastError = null;
    }
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
