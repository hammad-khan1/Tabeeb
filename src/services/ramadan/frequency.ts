/**
 * Reads when a medicine is taken from how Pakistani prescriptions write it: "1+0+1",
 * "½+0+½", "subah shaam", "raat ko", "khane ke baad", the Urdu equivalents, the
 * English abbreviations, and on a Ramzan prescription "sehri" and "iftar".
 *
 * This reads timing only. The digits in "1+0+1" are how many tablets, and nothing here
 * keeps them: a dose is the doctor's, never Tabeeb's.
 */

import { normalizeUrdu } from '../nlp/urdu';

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

/** Slots a Ramzan prescription can name explicitly. */
export type RamadanMedicineSlot = 'sehri' | 'iftar';

export interface ParsedFrequency {
  dayParts: DayPart[];
  ramadanSlots: RamadanMedicineSlot[];
  /** From OD / BD / TDS when no times are written. */
  timesPerDay: number | null;
  withFood: 'before' | 'after' | null;
  /** False when nothing in the text was understood. */
  recognised: boolean;
}

const DAY_PART_ORDER: readonly DayPart[] = ['morning', 'afternoon', 'evening', 'night'];

/**
 * Position meaning in the dash and plus notation: three places are morning, afternoon
 * and night ("1+0+1" is subah and raat); four add evening before night.
 */
const POSITIONS: Record<3 | 4, readonly DayPart[]> = {
  3: ['morning', 'afternoon', 'night'],
  4: ['morning', 'afternoon', 'evening', 'night'],
};

// One digit, optionally halved ("0.5", "1/2"): a tablet count, never a date like
// 2025-03-01, which would otherwise read as three doses.
const AMOUNT = String.raw`(?:\d(?:[./]\d)?|[½¼¾])`;
const SEPARATOR = String.raw`\s*[+\-–]\s*`;
const POSITIONAL = new RegExp(
  String.raw`(?:^|[^\d./])(${AMOUNT})${SEPARATOR}(${AMOUNT})${SEPARATOR}(${AMOUNT})(?:${SEPARATOR}(${AMOUNT}))?(?![\d./])`
);

function isNonZero(amount: string): boolean {
  if (/[½¼¾]/.test(amount)) return true;
  if (amount.includes('/')) {
    const [numerator] = amount.split('/').map(Number);
    return numerator > 0;
  }
  return Number(amount) > 0;
}

/** Roman and English words, matched as whole words. */
const ROMAN_DAY_PARTS: Array<[RegExp, DayPart]> = [
  [/\b(?:subah|subha|subh|sobah|morning)\b/, 'morning'],
  [/\b(?:dopahar|dopehar|dupahar|dopher|noon|afternoon|lunch)\b/, 'afternoon'],
  [/\b(?:shaam|sham|evening)\b/, 'evening'],
  [/\b(?:raat|rat|night|bedtime|hs|sone se pehle|sone se pahle)\b/, 'night'],
];

/** Urdu-script phrases, matched after normalizeUrdu as substrings. */
const URDU_DAY_PARTS: Array<[string, DayPart]> = [
  ['صبح', 'morning'],
  ['دوپہر', 'afternoon'],
  ['شام', 'evening'],
  ['رات', 'night'],
  ['سونے سے پہلے', 'night'],
  ['سوتے وقت', 'night'],
];

const ROMAN_RAMADAN: Array<[RegExp, RamadanMedicineSlot]> = [
  [/\b(?:sehri|sehari|sahri|sahari|suhoor|suhur|sehr)\b/, 'sehri'],
  [/\b(?:iftar|iftaar|aftar|aftari|iftari)\b/, 'iftar'],
];

const URDU_RAMADAN: Array<[string, RamadanMedicineSlot]> = [
  ['سحری', 'sehri'],
  ['افطار', 'iftar'],
];

const TIMES_PER_DAY: Array<[RegExp, number]> = [
  [/\b(?:od|once daily|once a day|qd|ek baar|ek dafa)\b/, 1],
  [/\b(?:bd|bid|twice daily|twice a day|do baar|do dafa)\b/, 2],
  [/\b(?:tds|tid|thrice daily|three times a day|teen baar|teen dafa)\b/, 3],
  [/\b(?:qid|qds|four times a day|char baar|chaar baar)\b/, 4],
];

const URDU_TIMES_PER_DAY: Array<[string, number]> = [
  ['ایک بار', 1],
  ['دن میں ایک', 1],
  ['دو بار', 2],
  ['تین بار', 3],
  ['چار بار', 4],
];

const AFTER_FOOD = /\b(?:khane ke baad|khana khane ke baad|khaane ke baad|after meals?|after food|pc)\b/;
const BEFORE_FOOD = /\b(?:khane se pehle|khane se pahle|khaane se pehle|before meals?|before food|ac|empty stomach|khali pet)\b/;

export function parseFrequency(raw: string | null | undefined): ParsedFrequency {
  const result: ParsedFrequency = {
    dayParts: [],
    ramadanSlots: [],
    timesPerDay: null,
    withFood: null,
    recognised: false,
  };
  if (!raw?.trim()) return result;

  const text = normalizeUrdu(raw).toLowerCase();
  const dayParts = new Set<DayPart>();
  const slots = new Set<RamadanMedicineSlot>();

  const positional = POSITIONAL.exec(text);
  if (positional) {
    const amounts = positional.slice(1).filter((amount): amount is string => amount !== undefined);
    const positions = POSITIONS[amounts.length as 3 | 4];
    amounts.forEach((amount, index) => {
      if (isNonZero(amount)) dayParts.add(positions[index]);
    });
    result.recognised = true;
  }

  for (const [pattern, part] of ROMAN_DAY_PARTS) if (pattern.test(text)) dayParts.add(part);
  for (const [phrase, part] of URDU_DAY_PARTS) if (text.includes(normalizeUrdu(phrase))) dayParts.add(part);
  for (const [pattern, slot] of ROMAN_RAMADAN) if (pattern.test(text)) slots.add(slot);
  for (const [phrase, slot] of URDU_RAMADAN) if (text.includes(normalizeUrdu(phrase))) slots.add(slot);

  for (const [pattern, count] of TIMES_PER_DAY) {
    if (pattern.test(text)) result.timesPerDay = count;
  }
  for (const [phrase, count] of URDU_TIMES_PER_DAY) {
    if (text.includes(normalizeUrdu(phrase))) result.timesPerDay = count;
  }

  if (AFTER_FOOD.test(text) || text.includes(normalizeUrdu('کھانے کے بعد'))) result.withFood = 'after';
  else if (BEFORE_FOOD.test(text) || text.includes(normalizeUrdu('کھانے سے پہلے'))) result.withFood = 'before';

  result.dayParts = DAY_PART_ORDER.filter((part) => dayParts.has(part));
  result.ramadanSlots = (['sehri', 'iftar'] as const).filter((slot) => slots.has(slot));
  result.recognised =
    result.recognised ||
    result.dayParts.length > 0 ||
    result.ramadanSlots.length > 0 ||
    result.timesPerDay !== null ||
    result.withFood !== null;

  return result;
}
