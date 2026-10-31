import { describe, expect, it } from 'vitest';
import {
  dateLabelsBetween,
  localDateAt,
  localMidnightUtc,
  parseCalendarDate,
} from '../src/modules/analytics/time.js';

describe('analytics calendar calculations', () => {
  it('resolves local midnight correctly across daylight-saving changes', () => {
    const beforeChange = localMidnightUtc('2026-03-28', 'Europe/Paris');
    const afterChange = localMidnightUtc('2026-03-29', 'Europe/Paris');
    const nextDay = localMidnightUtc('2026-03-30', 'Europe/Paris');

    expect(beforeChange.toISOString()).toBe('2026-03-27T23:00:00.000Z');
    expect(afterChange.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(nextDay.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(dateLabelsBetween(beforeChange, nextDay, 'Europe/Paris')).toEqual([
      '2026-03-28',
      '2026-03-29',
    ]);
    expect(
      localDateAt(new Date('2026-03-29T22:30:00.000Z'), 'Europe/Paris'),
    ).toBe('2026-03-30');
  });

  it('rejects invalid calendar dates', () => {
    expect(parseCalendarDate('2026-02-28', 'from')).toBe('2026-02-28');
    expect(() => parseCalendarDate('2026-02-30', 'from')).toThrow();
    expect(() => parseCalendarDate('28-02-2026', 'from')).toThrow();
  });
});
