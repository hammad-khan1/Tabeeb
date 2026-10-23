import { describe, it, expect } from 'vitest';
import { hbKeepsFalling, ironSummary, ttPlan } from './supplements';

describe('ironSummary', () => {
  it('counts the run of days up to today', () => {
    expect(ironSummary(['2026-10-15', '2026-10-16', '2026-10-17'], '2026-10-17')).toEqual({
      takenToday: true,
      streak: 3,
      totalDays: 3,
    });
  });

  it('keeps yesterday\'s run alive until today is over', () => {
    expect(ironSummary(['2026-10-15', '2026-10-16'], '2026-10-17')).toMatchObject({ takenToday: false, streak: 2 });
  });

  it('starts again after a missed day, but keeps the total', () => {
    expect(ironSummary(['2026-10-10', '2026-10-11', '2026-10-16', '2026-10-17'], '2026-10-17')).toEqual({
      takenToday: true,
      streak: 2,
      totalDays: 4,
    });
  });

  it('ignores future days', () => {
    expect(ironSummary(['2026-10-18'], '2026-10-17')).toEqual({ takenToday: false, streak: 0, totalDays: 0 });
  });
});

describe('ttPlan', () => {
  const TODAY = '2026-10-17';

  it('gives two doses four weeks apart when she has had none', () => {
    expect(ttPlan(0, [], TODAY)).toEqual([
      { number: 1, status: 'due', givenOn: null, earliest: TODAY },
      { number: 2, status: 'later', givenOn: null, earliest: null },
    ]);
  });

  it('treats unknown history as none', () => {
    expect(ttPlan(null, [], TODAY).map((dose) => dose.number)).toEqual([1, 2]);
  });

  it('makes the second dose due four weeks after the first', () => {
    const plan = ttPlan(0, ['2026-09-01'], TODAY);
    expect(plan[1]).toEqual({ number: 2, status: 'due', givenOn: null, earliest: '2026-09-29' });

    const tooSoon = ttPlan(0, ['2026-10-10'], TODAY);
    expect(tooSoon[1]).toMatchObject({ status: 'later', earliest: '2026-11-07' });
  });

  it('gives the next dose in the series after earlier doses', () => {
    expect(ttPlan(2, [], TODAY)).toEqual([{ number: 3, status: 'due', givenOn: null, earliest: TODAY }]);
  });

  it('needs nothing after five doses', () => {
    expect(ttPlan(5, [], TODAY)).toEqual([]);
  });

  it('shows doses given in this pregnancy as given', () => {
    expect(ttPlan(1, ['2026-08-01'], TODAY)).toEqual([
      { number: 2, status: 'given', givenOn: '2026-08-01', earliest: null },
    ]);
  });
});

describe('hbKeepsFalling', () => {
  it('flags three readings each lower than the last', () => {
    expect(hbKeepsFalling([11.6, 10.9, 10.1])).toBe(true);
    expect(hbKeepsFalling([12.5, 11.6, 10.9, 10.1])).toBe(true);
  });

  it('does not flag a recovery, a plateau or too few readings', () => {
    expect(hbKeepsFalling([11.6, 10.1, 10.9])).toBe(false);
    expect(hbKeepsFalling([11.0, 10.5, 10.5])).toBe(false);
    expect(hbKeepsFalling([11.0, 10.5])).toBe(false);
  });
});
