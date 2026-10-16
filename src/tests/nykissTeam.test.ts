import {describe, it, expect} from 'vitest';
import {buildIndex, memberTitle, pollDelay, TeamMember} from '@lib/nykiss/teamModel';

const base = (over: Partial<TeamMember> = {}): TeamMember => ({
  telegram_id: 101, name: 'Иван', role: 'worker', rank: {level: 3, name: 'Волк', color: '#C9A227'},
  fire: {len: 7, tier: 2, tier_name: 'Огонёк', state: 'active'}, achievements: ['a', 'b', 'c', 'd'], online: true, me: false, ...over
});

describe('nykiss team model', () => {
  it('indexes colleagues by peer id and skips me', () => {
    const idx = buildIndex([base(), base({telegram_id: 102, me: true})]);
    expect([...idx.keys()]).toEqual(['101']);
  });

  it('treats the server answer as untrusted', () => {
    expect(buildIndex(null).size).toBe(0);
    expect(buildIndex([null, 5, {}, {telegram_id: '1'}]).size).toBe(0);
    const idx = buildIndex([{telegram_id: 7, name: 'X', role: 'admin', rank: {bad: 1}, fire: {len: 'x'}, achievements: 'no', online: 1}]);
    const m = idx.get('7')!;
    expect(m.role).toBe('worker');
    expect(m.rank).toBeNull();
    expect(m.fire).toBeNull();
    expect(m.achievements).toEqual([]);
    expect(m.online).toBe(true);
  });

  it('keeps at most three achievements', () => {
    expect(buildIndex([base()]).get('101')!.achievements).toHaveLength(3);
  });

  it('title shows nick, rank, streak and presence — and no money', () => {
    const t = memberTitle(base());
    expect(t).toBe('NYKISS · Иван · Волк · серия 7 дн. · в сети');
    expect(memberTitle(base({online: false, fire: null, rank: null, role: 'lead'}))).toBe('NYKISS · Иван · тимлид · не в сети');
    expect(t).not.toMatch(/\$|баланс|доход/i);
  });

  it('poll delay doubles after failures up to the cap', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(f => pollDelay(f))).toEqual([60000, 60000, 120000, 240000, 480000, 600000, 600000]);
  });

  it('poll delay never goes below the server Retry-After', () => {
    expect(pollDelay(1, 900000)).toBe(900000);
  });
});
