// src/lib/nykiss/startFolder.ts
// NYKISS Gram — after a reload the app must open on «Все» (all chats). Our folder passes (creating / reordering
// «Тёплые» and «Горячие» right after the start) can leave another tab selected, so for the first seconds we put
// «Все» back — unless the person already touched the folder strip themselves.

import useFolders from '@stores/folders';

const CHECK_AT_MS = [2500, 5000, 8000, 12000, 18000, 26000];
const STRIP_SEL = '#folders-tabs';
const TAB_SEL = '.menu-horizontal-div-item';

let touched = false;

function markTouched(e: Event) {
  if((e.target as HTMLElement | null)?.closest?.(STRIP_SEL)) touched = true;
}

// the first tab is «Все»; its absence from the active place means another folder is showing
function allChatsActive() {
  const first = document.querySelector<HTMLElement>(`${STRIP_SEL} ${TAB_SEL}`);
  if(!first) return true; // the strip is not drawn yet (or there is a single list): nothing to fix
  return first.classList.contains('active');
}

function check() {
  if(touched || allChatsActive()) return;
  try {
    useFolders().onClick()?.(0);
  } catch(e) {
    console.warn('[nykiss] start folder failed', e);
  }
}

export function initStartFolder() {
  document.addEventListener('pointerdown', markTouched, true);
  document.addEventListener('keydown', markTouched, true);
  CHECK_AT_MS.forEach((ms) => window.setTimeout(check, ms));
}
