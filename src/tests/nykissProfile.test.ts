import {achPct, daysWord, earningsRows, fmtMoney, fmtMskDay, fmtMskTime, mskDayKey, sparkPoints} from '@lib/nykiss/profileModel';

describe('nykiss profile model', () => {
  test('fmtMoney: whole dollars have no cents, fractions have two digits', () => {
    expect(fmtMoney(70)).toBe('$70');
    expect(fmtMoney(55.25)).toBe('$55,25');
    expect(fmtMoney(312.5)).toBe('$312,50');
    expect(fmtMoney(1234)).toBe('$1 234');
    expect(fmtMoney(0)).toBe('$0');
    expect(fmtMoney(NaN as any)).toBe('$0');
  });

  test('fmtMskTime: uses Moscow time, treats a zone-less ISO string as UTC', () => {
    // 21:30 UTC = 00:30 MSK next day
    expect(fmtMskTime('2026-10-14T21:30:00Z')).toMatch(/15 окт.*00:30/);
    expect(fmtMskTime('2026-10-14T21:30:00')).toMatch(/15 окт.*00:30/);
    expect(fmtMskTime('2026-10-14T21:30:00+00:00')).toMatch(/15 окт.*00:30/);
    expect(fmtMskTime(null)).toBe('');
    expect(fmtMskTime('not a date')).toBe('');
  });

  test('fmtMskDay: a plain date is not shifted by the time zone', () => {
    expect(fmtMskDay('2026-10-09')).toBe('9 октября');
    expect(fmtMskDay('2026-01-01')).toBe('1 января');
    expect(fmtMskDay('2026-10-09T10:00:00Z')).toBe('');
    expect(fmtMskDay(undefined)).toBe('');
  });

  test('achPct clamps and survives a missing target', () => {
    expect(achPct(640, 1000)).toBe(64);
    expect(achPct(5, 5)).toBe(100);
    expect(achPct(9, 5)).toBe(100);
    expect(achPct(-3, 5)).toBe(0);
    expect(achPct(3, 0)).toBe(0);
    expect(achPct(3, null)).toBe(0);
  });

  test('sparkPoints: flat line at the bottom for zeros, peak at the top, evenly spaced', () => {
    expect(sparkPoints([], 100, 50)).toBe('');
    expect(sparkPoints([0, 0, 0], 100, 50)).toBe('3.0,47.0 50.0,47.0 97.0,47.0');
    const pts = sparkPoints([0, 10], 100, 50).split(' ');
    expect(pts[0]).toBe('3.0,47.0');
    expect(pts[1]).toBe('97.0,3.0');
  });

  test('daysWord declines correctly', () => {
    expect([1, 2, 4, 5, 11, 12, 21, 22, 25, 111].map(daysWord)).toEqual(
      ['день', 'дня', 'дня', 'дней', 'дней', 'дней', 'день', 'дня', 'дней', 'дней']
    );
  });

  test('mskDayKey: the Moscow date, not the UTC one', () => {
    expect(mskDayKey(new Date('2026-10-14T21:30:00Z'))).toBe('2026-10-15');
    expect(mskDayKey(new Date('2026-10-14T20:59:00Z'))).toBe('2026-10-14');
  });

  test('earningsRows: money and rank rows, nothing when there is nothing to show', () => {
    expect(earningsRows(null)).toBeNull();
    expect(earningsRows({})).toBeNull();
    const r = earningsRows({
      rank: {name: 'Золото', color: '#C9A227'},
      streak: {current: 5, visible: true, state: 'active'},
      periods: {today: {earned: 100}, month: {earned: 640}}
    });
    expect(r.money).toEqual({today: '$100', month: '$640', aria: 'Заработок: сегодня $100, за месяц $640'});
    expect(r.rank).toEqual({name: 'Золото', color: '#C9A227', fire: 'Огонёк: 5 дней'});
  });

  test('earningsRows: an old server without periods still gives the rank row; a bad colour is dropped', () => {
    const r = earningsRows({rank: {name: 'Белый', color: 'red;background:url(x)'}, streak: {current: 0}});
    expect(r.money).toBeNull();
    expect(r.rank).toEqual({name: 'Белый', color: null, fire: null});
    expect(earningsRows({streak: {current: 2, state: 'lost'}})).toBeNull();
  });

  test('earningsRows never exposes company share fields', () => {
    const r = earningsRows({periods: {today: {earned: 1}, month: {earned: 2}}, our_income: 99, commission: 5} as any);
    expect(JSON.stringify(r)).not.toMatch(/our_income|commission|house/);
  });
});
