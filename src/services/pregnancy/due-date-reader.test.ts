import { describe, it, expect } from 'vitest';
import { readDueDates } from './due-date-reader';

describe('readDueDates', () => {
  it('reads a day-first date after "EDD"', () => {
    expect(readDueDates('Single live intrauterine fetus. GA 20w 3d. EDD: 23/03/2027')).toEqual([
      { date: '2027-03-23', matched: 'EDD 23/03/2027', ambiguous: false },
    ]);
  });

  it('reads the common label and date styles', () => {
    expect(readDueDates('Expected date of delivery 5-Jan-2027')[0].date).toBe('2027-01-05');
    expect(readDueDates('E.D.D. 05.01.2027')[0].date).toBe('2027-01-05');
    expect(readDueDates('Estimated due date: January 5, 2027')[0].date).toBe('2027-01-05');
    expect(readDueDates('EDD (by US) 2027-01-05')[0].date).toBe('2027-01-05');
    expect(readDueDates('EDD 5th March 2027')[0].date).toBe('2027-03-05');
  });

  it('reads Urdu labels and Eastern digits', () => {
    expect(readDueDates('متوقع تاریخ پیدائش: ۲۳/۰۳/۲۰۲۷')[0].date).toBe('2027-03-23');
  });

  it('flags a date whose day and month could be swapped', () => {
    expect(readDueDates('EDD 05/03/2027')[0]).toMatchObject({ date: '2027-03-05', ambiguous: true });
  });

  it('ignores dates that are not next to a due-date label', () => {
    expect(readDueDates('Scan date 12/10/2026. LMP 01/04/2026.')).toEqual([]);
  });

  it('ignores impossible dates', () => {
    expect(readDueDates('EDD 31/02/2027')).toEqual([]);
  });

  it('lists each different date once', () => {
    const text = 'EDD by LMP: 06/01/2027. EDD by US: 10/01/2027. EDD: 06/01/2027';
    expect(readDueDates(text).map((candidate) => candidate.date)).toEqual(['2027-01-06', '2027-01-10']);
  });
});
