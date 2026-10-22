/**
 * Sehri and Iftar times, computed offline with adhan: University of Islamic Sciences,
 * Karachi method (Fajr and Isha at 18°) and Hanafi Asr. No network call, so a patient
 * with no signal at Sehri still gets the time.
 *
 * Sehri ends at Fajr and the fast opens at Maghrib. Many local timetables end Sehri a
 * few minutes before Fajr as a precaution; that margin is a religious choice, so it is
 * not applied here and the UI points patients to their local timetable for it.
 */

import { CalculationMethod, Coordinates, Madhab, PrayerTimes } from 'adhan';

export const PAKISTAN_TIME_ZONE = 'Asia/Karachi';

export interface Location {
  latitude: number;
  longitude: number;
}

export interface City extends Location {
  id: string;
  name: string;
  nameUr: string;
}

/** City centres. Close enough for prayer times, which move about a minute per 15 km. */
export const PAKISTAN_CITIES: readonly City[] = [
  { id: 'karachi', name: 'Karachi', nameUr: 'کراچی', latitude: 24.8607, longitude: 67.0011 },
  { id: 'lahore', name: 'Lahore', nameUr: 'لاہور', latitude: 31.5204, longitude: 74.3587 },
  { id: 'islamabad', name: 'Islamabad', nameUr: 'اسلام آباد', latitude: 33.6844, longitude: 73.0479 },
  { id: 'rawalpindi', name: 'Rawalpindi', nameUr: 'راولپنڈی', latitude: 33.5651, longitude: 73.0169 },
  { id: 'peshawar', name: 'Peshawar', nameUr: 'پشاور', latitude: 34.0151, longitude: 71.5249 },
  { id: 'quetta', name: 'Quetta', nameUr: 'کوئٹہ', latitude: 30.1798, longitude: 66.975 },
  { id: 'multan', name: 'Multan', nameUr: 'ملتان', latitude: 30.1575, longitude: 71.5249 },
  { id: 'faisalabad', name: 'Faisalabad', nameUr: 'فیصل آباد', latitude: 31.4504, longitude: 73.135 },
  { id: 'hyderabad', name: 'Hyderabad', nameUr: 'حیدرآباد', latitude: 25.396, longitude: 68.3578 },
  { id: 'sialkot', name: 'Sialkot', nameUr: 'سیالکوٹ', latitude: 32.4945, longitude: 74.5229 },
  { id: 'gujranwala', name: 'Gujranwala', nameUr: 'گوجرانوالہ', latitude: 32.1877, longitude: 74.1945 },
];

export function findCity(id: string): City | null {
  return PAKISTAN_CITIES.find((city) => city.id === id) ?? null;
}

/** Coordinates from a city id, or from the browser's geolocation. */
export function validateLocation(location: Location): Location {
  const { latitude, longitude } = location;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError(`Invalid latitude: ${latitude}`);
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError(`Invalid longitude: ${longitude}`);
  }
  return { latitude, longitude };
}

export interface FastingDay {
  /** YYYY-MM-DD, the civil date in the patient's time zone. */
  date: string;
  /** Fajr: Sehri ends and the fast begins. */
  sehriEnds: Date;
  /** Maghrib: Iftar. */
  iftar: Date;
  isha: Date;
  fastingMinutes: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(date: string): { year: number; month: number; day: number } {
  const match = ISO_DATE.exec(date);
  if (!match) throw new RangeError(`Expected YYYY-MM-DD, got "${date}"`);

  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError(`Not a calendar date: "${date}"`);
  }
  return { year, month, day };
}

export function fastingTimes(date: string, location: Location): FastingDay {
  const { year, month, day } = parseIsoDate(date);
  const { latitude, longitude } = validateLocation(location);

  const params = CalculationMethod.Karachi();
  params.madhab = Madhab.Hanafi;

  // adhan reads the calendar day from the Date's local fields, so it is built from
  // local fields too — the server's own time zone then cannot shift the day.
  const times = new PrayerTimes(
    new Coordinates(latitude, longitude),
    new Date(year, month - 1, day),
    params
  );

  return {
    date,
    sehriEnds: times.fajr,
    iftar: times.maghrib,
    isha: times.isha,
    fastingMinutes: Math.round((times.maghrib.getTime() - times.fajr.getTime()) / 60_000),
  };
}

/** HH:mm on a 24-hour clock in the given zone. */
export function formatClock(instant: Date, timeZone = PAKISTAN_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}

/** Today's civil date, YYYY-MM-DD, in the given zone. */
export function localDate(instant: Date = new Date(), timeZone = PAKISTAN_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
