import {isNewDialogCandidate, mskDayStartSec} from '@lib/nykiss/dayStatsModel';

const dayStart = mskDayStartSec('2026-10-22');
const base = {peerId: 1001, myId: 7, out: false, date: dayStart + 3600, dayStart, known: new Set<number>()};

describe('nykiss new dialog rule', () => {
  test('mskDayStartSec is Moscow midnight, not UTC midnight', () => {
    expect(new Date(dayStart * 1000).toISOString()).toBe('2026-10-21T21:00:00.000Z');
  });

  test('a fresh incoming message from a stranger is a candidate', () => {
    expect(isNewDialogCandidate(base)).toBe(true);
  });

  test('outgoing, self, Telegram service and groups are not', () => {
    expect(isNewDialogCandidate({...base, out: true})).toBe(false);
    expect(isNewDialogCandidate({...base, peerId: 7})).toBe(false);
    expect(isNewDialogCandidate({...base, peerId: 777000})).toBe(false);
    expect(isNewDialogCandidate({...base, peerId: -100123})).toBe(false);
    expect(isNewDialogCandidate({...base, peerId: NaN})).toBe(false);
  });

  test('people the worker already talks to are not new', () => {
    expect(isNewDialogCandidate({...base, known: new Set([1001])})).toBe(false);
  });

  test('a message from before today is replayed history', () => {
    expect(isNewDialogCandidate({...base, date: dayStart - 1})).toBe(false);
    expect(isNewDialogCandidate({...base, date: dayStart})).toBe(true);
  });
});
