import {describe, expect, it} from 'vitest';
import {filterQuickReplies, QuickReplyShortcut} from '@lib/nykiss/quickReplies';

const items: QuickReplyShortcut[] = [
  {id: 1, shortcut: 'hello', count: 1, preview: 'Hi! How can I help?'},
  {id: 2, shortcut: 'Help', count: 2, preview: 'Here is how'},
  {id: 3, shortcut: 'price', count: 1, preview: 'Prices start at 10$'}
];

describe('filterQuickReplies', () => {
  it('returns everything for a bare slash', () => {
    expect(filterQuickReplies(items, '/')).toHaveLength(3);
  });

  it('matches by the start of the shortcut, ignoring case', () => {
    expect(filterQuickReplies(items, '/he').map((i) => i.id)).toEqual([1, 2]);
    expect(filterQuickReplies(items, 'PR').map((i) => i.id)).toEqual([3]);
  });

  it('finds nothing for an unknown start or a query with spaces', () => {
    expect(filterQuickReplies(items, '/zzz')).toEqual([]);
    expect(filterQuickReplies(items, '/hello there')).toEqual([]);
  });
});
