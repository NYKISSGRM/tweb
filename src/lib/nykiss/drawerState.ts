// NYKISS Gram — the hamburger menu as a left drawer: the small pure pieces (what the account header says, whether an
// account row gets a counter, the scrim, the page behind the drawer) kept apart from the menu code so they can be tested.

const ACCOUNTS_COLLAPSED_KEY = 'nk-drawer-accounts-collapsed';

type DrawerUser = {
  username?: string,
  usernames?: Array<{username: string, pFlags?: {active?: true}}>,
  phone?: string
};

/** The line under the name in the drawer header: @username if there is one, else the phone number. */
export function getDrawerSubtitle(user: DrawerUser | undefined, formatPhone: (phone: string) => string = (phone) => '+' + phone) {
  if(!user) return;
  const username = user.usernames?.find((item) => item.pFlags?.active)?.username || user.username;
  if(username) return '@' + username;
  if(user.phone) return formatPhone(user.phone);
}

/** The counter of another account's row: nothing to show when there is nothing waiting, so the row stays plain. */
export function getAccountCounter(counts: Record<number, number | undefined> | undefined, accountNumber: number) {
  const count = counts?.[accountNumber];
  return count && count > 0 ? count : undefined;
}

/** A counter in a 20px pill: past 99 it reads «99+». */
export function formatAccountCounter(count: number) {
  return count > 99 ? '99+' : '' + count;
}

export function readAccountsCollapsed(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()) {
  try {
    return storage?.getItem(ACCOUNTS_COLLAPSED_KEY) === '1';
  } catch{
    return false;
  }
}

export function writeAccountsCollapsed(collapsed: boolean, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safeStorage()) {
  try {
    if(collapsed) storage?.setItem(ACCOUNTS_COLLAPSED_KEY, '1');
    else storage?.removeItem(ACCOUNTS_COLLAPSED_KEY);
  } catch{}
}

function safeStorage() {
  try {
    return localStorage;
  } catch{}
}

/**
 * The dimming layer behind the drawer, placed right before the menu so the menu paints over it. A scrim that is still
 * in place (the drawer is opened again while it closes) is reused, not doubled.
 */
export function ensureDrawerScrim(scrim: HTMLElement | undefined, menu: HTMLElement, onClick: () => void) {
  if(!scrim) {
    scrim = document.createElement('div');
    scrim.className = 'btn-menu-drawer-scrim';
    scrim.addEventListener('click', onClick);
  }

  if(scrim.nextElementSibling !== menu || !scrim.isConnected) {
    menu.before(scrim);
  }

  return scrim;
}

/** The page behind an open drawer is out of reach of the keyboard and of screen readers. */
export function setDrawerBackgroundInert(inert: boolean, root: Pick<Document, 'getElementById'> = document) {
  const column = root.getElementById('column-center');
  if(!column) return;
  if(inert) column.setAttribute('inert', '');
  else column.removeAttribute('inert');
}
