/**
 * Parsing for the numbers on a lab report. One implementation, because there were two
 * that disagreed: `extraction-schema` stripped digit-group separators and
 * `trends/lab-parser` did not, so a platelet count written "1,50,000" was stored as 1.
 *
 * Written for the reports this app actually receives: lakh grouping, Urdu digits,
 * censored values ("<5.7"), and reference ranges that are one-sided far more often
 * than the two-sided form the old regex required.
 */

export type Censoring = '<' | '>' | '≤' | '≥' | null;

export interface ParsedValue {
  value: number;
  /** Present when the report gave a bound rather than a measurement. */
  censoring: Censoring;
}

const ARABIC_INDIC_OFFSET = 0x0660; // ٠١٢٣٤٥٦٧٨٩
const EXTENDED_ARABIC_INDIC_OFFSET = 0x06f0; // ۰۱۲۳۴۵۶۷۸۹

/** Urdu lab reports are frequently typeset with Arabic-Indic digits. */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const char of input) {
    const code = char.codePointAt(0)!;
    if (code >= ARABIC_INDIC_OFFSET && code <= ARABIC_INDIC_OFFSET + 9) {
      out += String(code - ARABIC_INDIC_OFFSET);
    } else if (code >= EXTENDED_ARABIC_INDIC_OFFSET && code <= EXTENDED_ARABIC_INDIC_OFFSET + 9) {
      out += String(code - EXTENDED_ARABIC_INDIC_OFFSET);
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * Removes digit-group separators. Both western (1,500,000) and South Asian lakh/crore
 * (15,00,000) grouping appear in Pakistani reports, so any comma between digits is a
 * separator — a decimal comma would be ambiguous here and is not used on these forms.
 */
function stripGroupSeparators(input: string): string {
  return input.replace(/(\d),(?=\d)/g, '$1');
}

function readCensoring(input: string): { censoring: Censoring; rest: string } {
  const match = input.match(/^\s*(<=|>=|≤|≥|<|>)\s*/);
  if (!match) return { censoring: null, rest: input };

  const symbol = match[1];
  const censoring: Censoring =
    symbol === '<=' || symbol === '≤' ? '≤' : symbol === '>=' || symbol === '≥' ? '≥' : (symbol as '<' | '>');

  return { censoring, rest: input.slice(match[0].length) };
}

/**
 * Reads the numeric value from a lab result string, keeping any censoring marker
 * rather than discarding it — "<5.7" and "5.7" are clinically different statements.
 */
export function parseMedicalValue(raw: unknown): ParsedValue | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { value: raw, censoring: null } : null;
  }

  const normalized = normalizeDigits(String(raw)).trim();
  if (!normalized) return null;

  const { censoring, rest } = readCensoring(normalized);
  const cleaned = stripGroupSeparators(rest);

  // Anchored at the start so "12 leukocytes per field" reads 12, not a later number,
  // but a leading unit like "x10^9 3.4" is not mistaken for a value either.
  const match = cleaned.match(/^[^\d+-]*([+-]?\d+(?:\.\d+)?)/);
  if (!match) return null;

  const value = Number(match[1]);
  return Number.isFinite(value) ? { value, censoring } : null;
}

/** Convenience for callers that only want the number. */
export function parseNumericValue(raw: unknown): number | null {
  return parseMedicalValue(raw)?.value ?? null;
}

export interface ReferenceRange {
  min: number | null;
  max: number | null;
  /** A range with no numeric bounds, e.g. "Negative", "Non-reactive". */
  qualitative: string | null;
}

const QUALITATIVE_RANGES = new Map<string, string>([
  ['negative', 'negative'],
  ['non reactive', 'non-reactive'],
  ['non-reactive', 'non-reactive'],
  ['nonreactive', 'non-reactive'],
  ['not detected', 'not detected'],
  ['absent', 'absent'],
  ['nil', 'absent'],
  ['normal', 'normal'],
  ['reactive', 'reactive'],
  ['positive', 'positive'],
]);

/**
 * Handles every reference-range form these reports use. The previous regex matched
 * only `X-Y`, so "up to 4.2" and "< 200" silently reported every value as in range —
 * a TSH of 8.2 against "up to 4.2" was flagged normal.
 */
export function parseReferenceRange(raw: string | null | undefined): ReferenceRange | null {
  if (!raw) return null;

  const text = normalizeDigits(String(raw)).trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const qualitative = QUALITATIVE_RANGES.get(lower.replace(/[.\s]+$/, ''));
  if (qualitative) return { min: null, max: null, qualitative };

  const cleaned = stripGroupSeparators(text);
  const number = '(-?\\d+(?:\\.\\d+)?)';

  // Two-sided: "4.0 - 5.6", "4.0 to 5.6", "4.0–5.6". The dash form requires the
  // second number to be non-negative so "-2.5 - -1.0" does not mis-split.
  const twoSided =
    cleaned.match(new RegExp(`${number}\\s*(?:to|[-–—])\\s*${number}`, 'i')) ??
    cleaned.match(new RegExp(`${number}\\s*/\\s*${number}`));
  if (twoSided) {
    const min = Number(twoSided[1]);
    const max = Number(twoSided[2]);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { min: Math.min(min, max), max: Math.max(min, max), qualitative: null };
    }
  }

  // Upper bound only: "< 200", "≤ 200", "up to 4.2", "less than 200", "below 200".
  const upper = cleaned.match(
    new RegExp(`(?:<=?|≤|up\\s*to|less\\s+than|below|max(?:imum)?)\\s*${number}`, 'i')
  );
  if (upper) {
    const max = Number(upper[1]);
    if (Number.isFinite(max)) return { min: null, max, qualitative: null };
  }

  // Lower bound only: "> 40", "≥ 40", "at least 40", "above 40", "min 40".
  const lowerBound = cleaned.match(
    new RegExp(`(?:>=?|≥|at\\s*least|greater\\s+than|more\\s+than|above|min(?:imum)?)\\s*${number}`, 'i')
  );
  if (lowerBound) {
    const min = Number(lowerBound[1]);
    if (Number.isFinite(min)) return { min, max: null, qualitative: null };
  }

  return null;
}

/**
 * Whether a value falls outside its reference range. Returns null — not false — when
 * it cannot be determined, so "unknown" is never silently reported as "normal".
 */
export function isOutOfRange(
  value: number | null,
  referenceRange: string | null | undefined
): boolean | null {
  if (value === null) return null;

  const range = parseReferenceRange(referenceRange);
  if (!range || range.qualitative) return null;
  if (range.min === null && range.max === null) return null;

  if (range.min !== null && value < range.min) return true;
  if (range.max !== null && value > range.max) return true;
  return false;
}
