import { describe, it, expect } from 'vitest';
import {
  fastingTimes,
  findCity,
  formatClock,
  localDate,
  validateLocation,
  PAKISTAN_CITIES,
} from './prayer-times';

/** Minutes between two HH:mm clock readings. */
function minutesApart(a: string, b: string): number {
  const toMinutes = (clock: string) => {
    const [hours, minutes] = clock.split(':').map(Number);
    return hours * 60 + minutes;
  };
  return Math.abs(toMinutes(a) - toMinutes(b));
}

/**
 * Reference times from AlAdhan (api.aladhan.com, method=1 Karachi, school=1 Hanafi,
 * timezone Asia/Karachi), retrieved 2026-10-23. It is an independent implementation, so
 * agreement checks adhan's configuration here rather than adhan against itself.
 */
const REFERENCES = [
  {
    city: 'karachi',
    date: '2025-03-01',
    fajr: '05:39',
    maghrib: '18:34',
    isha: '19:50',
  },
  {
    city: 'lahore',
    date: '2027-02-15',
    fajr: '05:23',
    maghrib: '17:49',
    isha: '19:11',
  },
];

describe('fastingTimes', () => {
  for (const reference of REFERENCES) {
    it(`matches the published times for ${reference.city} on ${reference.date}`, () => {
      const city = findCity(reference.city)!;
      const day = fastingTimes(reference.date, city);

      expect(minutesApart(formatClock(day.sehriEnds), reference.fajr)).toBeLessThanOrEqual(2);
      expect(minutesApart(formatClock(day.iftar), reference.maghrib)).toBeLessThanOrEqual(2);
      expect(minutesApart(formatClock(day.isha), reference.isha)).toBeLessThanOrEqual(2);
    });
  }

  it('reports the length of the fast', () => {
    const day = fastingTimes('2025-03-01', findCity('karachi')!);
    // 05:39 to 18:34 is 12h55m.
    expect(Math.abs(day.fastingMinutes - 775)).toBeLessThanOrEqual(2);
  });

  it('computes the requested calendar day', () => {
    const day = fastingTimes('2025-03-01', findCity('karachi')!);
    expect(localDate(day.sehriEnds)).toBe('2025-03-01');
    expect(localDate(day.iftar)).toBe('2025-03-01');
  });

  it('accepts coordinates from the browser', () => {
    const day = fastingTimes('2025-03-01', { latitude: 24.9, longitude: 67.1 });
    expect(day.iftar.getTime()).toBeGreaterThan(day.sehriEnds.getTime());
  });

  it('rejects malformed dates and coordinates', () => {
    expect(() => fastingTimes('01-03-2025', findCity('karachi')!)).toThrow(RangeError);
    expect(() => fastingTimes('2025-02-30', findCity('karachi')!)).toThrow(RangeError);
    expect(() => validateLocation({ latitude: 91, longitude: 67 })).toThrow(RangeError);
    expect(() => validateLocation({ latitude: 24, longitude: Number.NaN })).toThrow(RangeError);
  });
});

describe('PAKISTAN_CITIES', () => {
  it('covers the cities in the spec', () => {
    expect(PAKISTAN_CITIES.map((city) => city.id)).toEqual([
      'karachi', 'lahore', 'islamabad', 'rawalpindi', 'peshawar', 'quetta',
      'multan', 'faisalabad', 'hyderabad', 'sialkot', 'gujranwala',
    ]);
  });

  it('places every city inside Pakistan', () => {
    for (const city of PAKISTAN_CITIES) {
      expect(city.latitude, city.id).toBeGreaterThan(23);
      expect(city.latitude, city.id).toBeLessThan(37.5);
      expect(city.longitude, city.id).toBeGreaterThan(60.5);
      expect(city.longitude, city.id).toBeLessThan(78);
    }
  });
});
