/**
 * Finds the expected date of delivery (EDD) in the text of an ultrasound report that
 * the existing OCR pipeline already read. Deterministic pattern matching, no model:
 * the result is offered to the family to confirm, never saved by itself.
 *
 * Pakistani reports write dates day-first (12/03/2027 is 12 March), so numeric dates
 * are read that way. When both parts could be the month the date is flagged as
 * ambiguous for the confirmation screen.
 */

import { normalizeEasternDigits } from '../nlp/urdu';

const LABEL =
  /\b(?:e\.?\s?d\.?\s?d\.?|expected\s+date\s+of\s+delivery|expected\s+delivery\s+date|estimated\s+date\s+of\s+(?:delivery|confinement)|estimated\s+due\s+date|due\s+date)\b|متوقع\s+تاریخ\s+(?:پیدائش|ولادت)/gi;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function monthNumber(name: string): number | undefined {
  const lower = name.toLowerCase();
  return MONTHS[lower.slice(0, 4)] ?? MONTHS[lower.slice(0, 3)];
}

export interface DueDateCandidate {
  date: string;
  /** The text the date was read from, for the confirmation screen. */
  matched: string;
  ambiguous: boolean;
}

function iso(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

/** The first date in a short window after a label. */
function readDate(window: string): { date: string; matched: string; ambiguous: boolean } | null {
  const patterns: Array<[RegExp, (m: RegExpExecArray) => { date: string | null; ambiguous: boolean }]> = [
    // 2027-03-12
    [/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/, (m) => ({ date: iso(+m[1], +m[2], +m[3]), ambiguous: false })],
    // 12/03/2027, 12-03-27
    [
      /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/,
      (m) => ({ date: iso(+m[3], +m[2], +m[1]), ambiguous: +m[1] <= 12 && +m[2] <= 12 && m[1] !== m[2] }),
    ],
    // 12 Mar 2027, 12-March-2027
    [
      /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})[\s,-]+(\d{2,4})\b/i,
      (m) => {
        const month = monthNumber(m[2]);
        return { date: month ? iso(+m[3], month, +m[1]) : null, ambiguous: false };
      },
    ],
    // March 12, 2027
    [
      /\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i,
      (m) => {
        const month = monthNumber(m[1]);
        return { date: month ? iso(+m[3], month, +m[2]) : null, ambiguous: false };
      },
    ],
  ];

  let best: { index: number; date: string; matched: string; ambiguous: boolean } | null = null;
  for (const [pattern, read] of patterns) {
    const match = pattern.exec(window);
    if (!match) continue;
    const { date, ambiguous } = read(match);
    if (date && (!best || match.index < best.index)) best = { index: match.index, date, matched: match[0], ambiguous };
  }
  return best ? { date: best.date, matched: best.matched, ambiguous: best.ambiguous } : null;
}

/** Characters after a label to look for its date; reports put it on the same line. */
const WINDOW = 40;

export function readDueDates(text: string): DueDateCandidate[] {
  const normalized = normalizeEasternDigits(text);
  const candidates: DueDateCandidate[] = [];

  for (const label of normalized.matchAll(LABEL)) {
    const start = (label.index ?? 0) + label[0].length;
    const found = readDate(normalized.slice(start, start + WINDOW));
    if (found && !candidates.some((candidate) => candidate.date === found.date)) {
      candidates.push({ date: found.date, matched: `${label[0]} ${found.matched}`.trim(), ambiguous: found.ambiguous });
    }
  }
  return candidates;
}
