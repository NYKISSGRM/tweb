// NYKISS Gram: Telegram Business quick replies (Premium). Typing "/" in a private chat offers the shortcuts, a pick sends
// the whole shortcut. This file is the pure part: the shape of a shortcut and the filtering of the list by the typed text.

export type QuickReplyShortcut = {
  id: number,
  shortcut: string,
  count: number,
  preview: string
};

/** `query` is what follows the slash, with or without it (`/he`, `he`): shortcuts that start with it, in the order they were given. */
export function filterQuickReplies(items: QuickReplyShortcut[], query: string) {
  const needle = query.replace(/^\//, '').trim().toLowerCase();
  if(/\s/.test(needle)) return [];
  return items.filter((item) => item.shortcut.toLowerCase().startsWith(needle));
}
