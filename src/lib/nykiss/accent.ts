// NYKISS: the accent colour of the app. One attribute on <html> (`data-nk-accent`) picks the set of CSS variables
// defined in scss/nykiss/theme.scss; the choice lives in localStorage and is applied on load, before the first paint.

export const ACCENTS = [
  {id: 'gold', title: 'Золото'},
  {id: 'violet', title: 'Фиолет'},
  {id: 'blue', title: 'Синий'},
  {id: 'green', title: 'Зелёный'},
  {id: 'red', title: 'Красный'}
] as const;

const LS_KEY = 'nk_accent';

export function getAccent(): string {
  try {
    const id = localStorage.getItem(LS_KEY);
    return ACCENTS.some((a) => a.id === id) ? id : ACCENTS[0].id;
  } catch{
    return ACCENTS[0].id;
  }
}

export function applyAccent(id: string = getAccent()) {
  document.documentElement.dataset.nkAccent = id;
}

/** Switches to the next accent in the list, returns its title. */
export function cycleAccent(): string {
  const index = ACCENTS.findIndex((a) => a.id === getAccent());
  const next = ACCENTS[(index + 1) % ACCENTS.length];
  try {
    localStorage.setItem(LS_KEY, next.id);
  } catch{}

  applyAccent(next.id);
  return next.title;
}

const RAIL_KEY = 'nk_rail';

export function isRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch{
    return false;
  }
}

export function applyRail(on: boolean = isRail()) {
  document.documentElement.toggleAttribute('data-nk-rail', on);
}

/** Folders as a column on the left (wide screens only) or as tabs on top. Returns the new state. */
export function toggleRail(): boolean {
  const on = !isRail();
  try {
    localStorage.setItem(RAIL_KEY, on ? '1' : '0');
  } catch{}

  applyRail(on);
  return on;
}

applyAccent();
applyRail();
