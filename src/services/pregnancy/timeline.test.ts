import { describe, it, expect } from 'vitest';
import {
  ANC_CONTACTS,
  addDays,
  buildSchedule,
  checkDueDate,
  checkLmp,
  contactStatus,
  daysBetween,
  dueDateFromLmp,
  gestationalAge,
  lmpFromDueDate,
  nextContact,
  phaseOf,
  reminderDue,
  visitReminderText,
} from './timeline';

describe('dates', () => {
  it('puts the due date 280 days after the last period', () => {
    expect(dueDateFromLmp('2026-04-01')).toBe('2027-01-06');
    expect(lmpFromDueDate('2027-01-06')).toBe('2026-04-01');
  });

  it('crosses month, year and leap-day boundaries correctly', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('rejects malformed dates', () => {
    expect(() => addDays('01-04-2026', 1)).toThrow(RangeError);
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });
});

describe('gestationalAge', () => {
  it('counts completed weeks and days', () => {
    expect(gestationalAge('2026-04-01', '2026-10-17')).toEqual({ weeks: 28, days: 3, totalDays: 199 });
    expect(gestationalAge('2026-04-01', '2026-04-01')).toEqual({ weeks: 0, days: 0, totalDays: 0 });
  });
});

describe('date checks', () => {
  it('accepts a last period in the past 44 weeks only', () => {
    expect(checkLmp('2026-04-01', '2026-10-17')).toEqual({ ok: true });
    expect(checkLmp('2026-10-20', '2026-10-17')).toEqual({ ok: false, reason: 'in_future' });
    expect(checkLmp('2025-01-01', '2026-10-17')).toEqual({ ok: false, reason: 'too_long_ago' });
  });

  it('accepts a due date up to four weeks past and 42 weeks ahead', () => {
    expect(checkDueDate('2027-01-06', '2026-10-17')).toEqual({ ok: true });
    expect(checkDueDate('2026-09-01', '2026-10-17')).toEqual({ ok: false, reason: 'already_passed' });
    expect(checkDueDate('2027-12-01', '2026-10-17')).toEqual({ ok: false, reason: 'too_far_ahead' });
  });
});

describe('the WHO 8-contact schedule', () => {
  it('has eight contacts at the WHO weeks', () => {
    expect(ANC_CONTACTS.map((contact) => contact.week)).toEqual([12, 20, 26, 30, 34, 36, 38, 40]);
  });

  const LMP = '2026-04-01';

  it('dates each contact from the last period', () => {
    const schedule = buildSchedule(LMP, '2026-04-10');
    expect(schedule[3]).toMatchObject({ number: 4, week: 30, date: '2026-10-28' });
  });

  it('marks a contact due from a week before until two weeks after its week', () => {
    const contact = { number: 4, week: 30, doneOn: null };
    // Week 30 is 2026-10-28.
    expect(contactStatus(contact, LMP, '2026-10-20')).toBe('upcoming');
    expect(contactStatus(contact, LMP, '2026-10-21')).toBe('due');
    expect(contactStatus(contact, LMP, '2026-11-11')).toBe('due');
    expect(contactStatus(contact, LMP, '2026-11-12')).toBe('missed');
  });

  it('treats the first contact as due from the start, and missed after 12 weeks', () => {
    const first = { number: 1, week: 12, doneOn: null };
    expect(contactStatus(first, LMP, '2026-04-20')).toBe('due');
    expect(contactStatus(first, LMP, '2026-06-25')).toBe('missed');
  });

  it('marks done visits done whenever they happened', () => {
    expect(contactStatus({ number: 4, week: 30, doneOn: '2026-11-20' }, LMP, '2026-12-01')).toBe('done');
  });

  it('shows the next visit not yet done or missed', () => {
    const done = new Map([
      [1, '2026-06-01'],
      [2, '2026-08-19'],
      [3, '2026-09-30'],
    ]);
    const schedule = buildSchedule(LMP, '2026-10-24', done);
    expect(schedule.slice(0, 3).map((c) => c.status)).toEqual(['done', 'done', 'done']);
    expect(nextContact(schedule)).toMatchObject({ number: 4, status: 'due' });
  });

  it('reminds in the three days before a visit', () => {
    const schedule = buildSchedule(LMP, '2026-10-25');
    expect(reminderDue(schedule[3], '2026-10-25')).toBe(true);
    expect(reminderDue(schedule[3], '2026-10-24')).toBe(false);
    expect(reminderDue(schedule[3], '2026-10-29')).toBe(false);
  });
});

describe('visitReminderText', () => {
  it('names the mother so the family knows', () => {
    expect(visitReminderText('Fatima', 30, 1).roman).toBe('Kal Fatima ka 30 hafte ka checkup hai.');
    expect(visitReminderText('Fatima', 30, 1).ur).toBe('کل Fatima کا 30 ہفتے کا چیک اپ ہے۔');
    expect(visitReminderText('Fatima', 30, 0).roman).toBe('Aaj Fatima ka 30 hafte ka checkup hai.');
    expect(visitReminderText('Fatima', 30, 3).en).toBe("In 3 days: Fatima's 30-week check-up.");
  });
});

describe('phaseOf', () => {
  it('moves from pregnancy to six weeks of postnatal care', () => {
    expect(phaseOf({ status: 'active', deliveredOn: null }, '2026-10-17')).toBe('antenatal');
    expect(phaseOf({ status: 'delivered', deliveredOn: '2027-01-05' }, '2027-02-16')).toBe('postnatal');
    expect(phaseOf({ status: 'delivered', deliveredOn: '2027-01-05' }, '2027-02-17')).toBe('ended');
    expect(phaseOf({ status: 'ended', deliveredOn: null }, '2026-10-17')).toBe('ended');
  });
});
