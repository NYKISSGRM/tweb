// NYKISS Gram — данные для двух строк в нативном профиле: GET /messenger/profile по личному ключу.
// Из памяти на пару минут: профиль открывают часто, а лимит сервера общий на IP. Кэш не переживает смену ключа,
// смену аккаунта (IDENTITY_EVENT) и смену московских суток (сегодня обнуляется в 00:00 МСК).

import {getKey} from '@lib/nykiss/quickBubble';
import {IDENTITY_EVENT, teamApi} from '@lib/nykiss/team';
import {mskDayKey} from '@lib/nykiss/profileModel';

// Только то, что читает earningsRows; остальное сервер отдаёт для мини-аппы, здесь оно не нужно.
export type Profile = {
  rank?: {name: string, color?: string} | null,
  streak?: {current?: number, visible?: boolean, state?: string} | null,
  periods?: {today: {earned: number}, month: {earned: number}} | null
};

const PROFILE_TTL_MS = 120_000;
let cache: {key: string, day: string, at: number, data: Profile} | null = null;
let inflight: Promise<Profile | null> | null = null;
let cacheWired = false;

export function loadProfile(force = false): Promise<Profile | null> {
  if(!cacheWired) {
    cacheWired = true;
    window.addEventListener(IDENTITY_EVENT, () => { cache = null; });
  }
  const key = getKey();
  if(!key) {
    cache = null;
    return Promise.resolve(null);
  }
  const day = mskDayKey();
  if(!force && cache && cache.key === key && cache.day === day && Date.now() - cache.at < PROFILE_TTL_MS) return Promise.resolve(cache.data);
  if(inflight) return inflight;
  inflight = teamApi('/messenger/profile').then((p: Profile | null) => {
    cache = p ? {key, day, at: Date.now(), data: p} : null;
    return p;
  }).finally(() => { inflight = null; });
  return inflight;
}
