import {describe, expect, it} from 'vitest';
import {MIN_DOCKED_CHAT_WIDTH, shouldFloatRightColumn} from '@helpers/updateColumnWidths';

describe('shouldFloatRightColumn', () => {
  it('docks the profile beside the chat while the chat keeps its minimum width', () => {
    // 1698 window, left 544 + right 435: 719 px stay for the chat
    expect(shouldFloatRightColumn(1698, 544 + 435)).toBe(false);
    expect(shouldFloatRightColumn(1000 + MIN_DOCKED_CHAT_WIDTH, 1000)).toBe(false);
  });

  it('floats the profile over the chat only when the chat would get too narrow', () => {
    expect(shouldFloatRightColumn(1000 + MIN_DOCKED_CHAT_WIDTH - 1, 1000)).toBe(true);
    expect(shouldFloatRightColumn(900, 544 + 435)).toBe(true);
  });
});
