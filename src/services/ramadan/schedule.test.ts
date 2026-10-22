import { describe, it, expect } from 'vitest';
import { buildDaySchedule, slotTime, type ScheduleMedicine } from './schedule';
import type { FastingDay } from './prayer-times';

/** A fixed day so the arithmetic is exact: Fajr 05:00, Maghrib 18:00, Isha 19:30 UTC. */
const DAY: FastingDay = {
  date: '2027-02-15',
  sehriEnds: new Date('2027-02-15T05:00:00Z'),
  iftar: new Date('2027-02-15T18:00:00Z'),
  isha: new Date('2027-02-15T19:30:00Z'),
  fastingMinutes: 780,
};

const METFORMIN: ScheduleMedicine = { id: 'm1', name: 'Metformin', frequency: '1+0+1' };
const DAONIL: ScheduleMedicine = { id: 'm2', name: 'Daonil', frequency: '1+0+0' };

describe('slotTime', () => {
  it('places each slot on the fasting clock', () => {
    expect(slotTime('sehri', DAY).toISOString()).toBe('2027-02-15T04:15:00.000Z');
    expect(slotTime('midday', DAY).toISOString()).toBe('2027-02-15T11:30:00.000Z');
    expect(slotTime('pre_iftar', DAY).toISOString()).toBe('2027-02-15T16:00:00.000Z');
    expect(slotTime('iftar', DAY).toISOString()).toBe('2027-02-15T18:00:00.000Z');
    expect(slotTime('post_iftar', DAY).toISOString()).toBe('2027-02-15T20:00:00.000Z');
    expect(slotTime('bedtime', DAY).toISOString()).toBe('2027-02-15T20:30:00.000Z');
  });
});

describe('buildDaySchedule', () => {
  it('always reminds for Sehri, Iftar and the three glucose checks', () => {
    const schedule = buildDaySchedule({ day: DAY, medicines: [], doctorConfirmed: false });

    expect(schedule.reminders.map((r) => `${r.kind}:${r.slot}`)).toEqual([
      'sehri:sehri',
      'glucose_check:midday',
      'glucose_check:pre_iftar',
      'iftar:iftar',
      'glucose_check:post_iftar',
    ]);
    expect(schedule.askDoctor).toBe(false);
  });

  it('gives no medicine a Ramzan time without a doctor-confirmed plan', () => {
    const schedule = buildDaySchedule({ day: DAY, medicines: [METFORMIN, DAONIL], doctorConfirmed: false });

    expect(schedule.reminders.filter((r) => r.kind === 'medicine')).toEqual([]);
    expect(schedule.unscheduled.map((m) => [m.name, m.reason])).toEqual([
      ['Metformin', 'awaiting_doctor_plan'],
      ['Daonil', 'awaiting_doctor_plan'],
    ]);
    expect(schedule.askDoctor).toBe(true);
  });

  it('times medicines the doctor wrote for Sehri and Iftar', () => {
    const schedule = buildDaySchedule({
      day: DAY,
      medicines: [
        { id: 'a', name: 'Metformin', frequency: 'sehri aur iftar' },
        { id: 'b', name: 'Gliclazide MR', frequency: 'افطار' },
        { id: 'c', name: 'Glargine', frequency: 'raat sone se pehle' },
      ],
      doctorConfirmed: true,
    });

    const medicine = schedule.reminders
      .filter((r) => r.kind === 'medicine')
      .map((r) => `${r.label}:${r.slot}`);
    expect(medicine).toEqual([
      'Metformin:sehri',
      'Metformin:iftar',
      'Gliclazide MR:iftar',
      'Glargine:bedtime',
    ]);
    expect(schedule.askDoctor).toBe(false);
  });

  it('will not place a daytime dose during the fast, even on a doctor plan', () => {
    const schedule = buildDaySchedule({ day: DAY, medicines: [DAONIL, METFORMIN], doctorConfirmed: true });

    expect(schedule.reminders.filter((r) => r.kind === 'medicine')).toEqual([]);
    expect(schedule.unscheduled.map((m) => m.reason)).toEqual(['falls_in_fast', 'falls_in_fast']);
    expect(schedule.askDoctor).toBe(true);
  });

  it('flags timing it cannot read or that contradicts itself', () => {
    const schedule = buildDaySchedule({
      day: DAY,
      medicines: [
        { id: 'a', name: 'Sitagliptin', frequency: 'as directed' },
        { id: 'b', name: 'Metformin', frequency: 'subah iftar' },
        { id: 'c', name: 'Pioglitazone', frequency: null },
      ],
      doctorConfirmed: true,
    });

    expect(schedule.unscheduled.map((m) => m.reason)).toEqual([
      'timing_unclear',
      'timing_unclear',
      'timing_unclear',
    ]);
  });

  it('keeps reminders in time order', () => {
    const schedule = buildDaySchedule({
      day: DAY,
      medicines: [{ id: 'c', name: 'Glargine', frequency: 'raat' }],
      doctorConfirmed: true,
    });
    const times = schedule.reminders.map((r) => r.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
