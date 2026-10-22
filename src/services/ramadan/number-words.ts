/**
 * Urdu and Roman-Urdu number words, 1 to 500, for glucose readings said aloud or typed
 * as words ("sugar baasath hai", "شوگر دو سو بیس").
 *
 * Urdu numbers below a hundred are not composed — each of 1–99 is its own word — so
 * they are listed in full. Hundreds compose: "do sau bees" is 220, and the fractional
 * forms "dedh sau" (150), "dhaai sau" (250), "sawa / sarhe / paune N sau" are how
 * readings are commonly spoken.
 *
 * Roman spellings vary, so a word that is not listed literally is matched on its
 * phonetic key from urdu.ts — but only when that key belongs to exactly one number.
 * "saat" (7) and "saath" (60) share a key; so do "sattaees" (27) and "sattaasi" (87).
 * A key two numbers share is never used, because reading 87 as 27 turns a normal
 * reading into a hypoglycaemia alert, and the reverse hides one.
 */

import { normalizeUrdu, romanKey } from '../nlp/urdu';

/** Index n holds the spellings of n; the first Roman spelling is the common one. */
const ROMAN_1_TO_99: readonly string[] = [
  '',
  'ek|aik|ik', 'do|du', 'teen|tin', 'chaar|char', 'paanch|panch', 'chhe|che|chay|chah', 'saat|sat',
  'aath|ath|aat', 'nau', 'das|dus',
  'gyarah|gyara|giyarah', 'barah|bara|baarah', 'terah|tera', 'chaudah|chauda|choda', 'pandrah|pandra',
  'solah|sola', 'satrah|satra', 'atharah|athara|attharah', 'unnees|unees|unnis', 'bees|bis',
  'ikkees|ikees|ikis', 'baees|bais|baais', 'teyees|teis|tayees', 'chaubees|chobees|chobis',
  'pachchees|pachees|pachis', 'chhabbees|chabees|chabbis', 'sattaees|sattais|satais',
  'athaees|athais|atthais', 'untees|untis', 'tees|tis',
  'ikattees|iktees|ikatis', 'battees|batees|battis', 'taintees|tetees|tentis',
  'chauntees|chontees|chontis', 'paintees|pentees|paintis', 'chhattees|chattees|chattis',
  'saintees|sentees|saintis', 'artees|adtees|artis', 'untaalees|untalees|untalis', 'chaalees|chalees|chalis',
  'iktaalees|iktalees|iktalis', 'bayaalees|bayalees|bealis', 'taintaalees|tentalees|taintalis',
  'chawaalees|chawalees|chawalis', 'paintaalees|pentalees|paintalis', 'chhiyaalees|chiyalees|chiyalis',
  'saintaalees|sentalees|saintalis', 'artaalees|artalees|artalis', 'unchaas|unchas', 'pachaas|pachas',
  'ikyaavan|ikyawan|ikawan', 'baavan|bawan', 'tirpan|trepan|tripan', 'chauvan|chowan|chauwan',
  'pachpan', 'chhappan|chappan', 'sattaavan|sattawan|satawan', 'atthaavan|athawan|athavan',
  'unsath|unsadh', 'saath|sath',
  'iksath|ikasath', 'baasath|basath|baasadh', 'tirsath|tresath', 'chaunsath|chonsath',
  'painsath|pensath', 'chhiyaasath|chiyasath', 'sarsath|sadsath', 'arsath|adsath', 'unhattar|unhatar',
  'sattar|satar',
  'ikhattar|ikhatar', 'bahattar|bahatar', 'tihattar|tehattar|tihatar', 'chauhattar|chohattar',
  'pachhattar|pachattar|pachatar', 'chhihattar|chihattar', 'satattar|sathattar', 'athattar|athhattar',
  'unaasi|unasi', 'assi|asi',
  'ikyaasi|ikyasi|ikasi', 'bayaasi|bayasi', 'tiraasi|tirasi', 'chauraasi|chaurasi|chorasi',
  'pachaasi|pachasi', 'chhiyaasi|chiyasi', 'sattaasi|sattasi', 'athaasi|athasi', 'navaasi|nawasi|navasi',
  'nabbe|nabay|navve',
  'ikyaanave|ikyanve', 'baanave|banve', 'tiraanave|tiranve', 'chauraanave|chauranve',
  'pachaanave|pachanve', 'chhiyaanave|chiyanve', 'sattaanave|sattanve', 'atthaanave|athanve',
  'ninyaanave|ninanve',
];

const URDU_1_TO_99: readonly string[] = [
  '',
  'ایک', 'دو', 'تین', 'چار', 'پانچ', 'چھ', 'سات', 'آٹھ', 'نو', 'دس',
  'گیارہ', 'بارہ', 'تیرہ', 'چودہ', 'پندرہ', 'سولہ', 'سترہ', 'اٹھارہ', 'انیس', 'بیس',
  'اکیس', 'بائیس', 'تئیس', 'چوبیس', 'پچیس', 'چھبیس', 'ستائیس', 'اٹھائیس', 'انتیس', 'تیس',
  'اکتیس', 'بتیس', 'تینتیس', 'چونتیس', 'پینتیس', 'چھتیس', 'سینتیس', 'اڑتیس', 'انتالیس', 'چالیس',
  'اکتالیس', 'بیالیس', 'تینتالیس', 'چوالیس', 'پینتالیس', 'چھیالیس', 'سینتالیس', 'اڑتالیس', 'انچاس', 'پچاس',
  'اکاون', 'باون', 'ترپن', 'چون', 'پچپن', 'چھپن', 'ستاون', 'اٹھاون', 'انسٹھ', 'ساٹھ',
  'اکسٹھ', 'باسٹھ', 'ترسٹھ', 'چونسٹھ', 'پینسٹھ', 'چھیاسٹھ', 'سڑسٹھ', 'اڑسٹھ', 'انہتر', 'ستر',
  'اکہتر', 'بہتر', 'تہتر', 'چوہتر', 'پچھتر', 'چھہتر', 'ستتر', 'اٹھہتر', 'اناسی', 'اسی',
  'اکیاسی', 'بیاسی', 'تراسی', 'چوراسی', 'پچاسی', 'چھیاسی', 'ستاسی', 'اٹھاسی', 'نواسی', 'نوے',
  'اکانوے', 'بانوے', 'ترانوے', 'چورانوے', 'پچانوے', 'چھیانوے', 'ستانوے', 'اٹھانوے', 'ننانوے',
];

const HUNDRED = { roman: ['sau', 'so', 'sou'], urdu: ['سو'] };

/** Multiplier words that only appear before "sau": dedh sau = 1.5 × 100. */
const WHOLE_FRACTIONS: ReadonlyArray<{ value: number; roman: string[]; urdu: string[] }> = [
  { value: 1.5, roman: ['dedh', 'derh', 'daidh'], urdu: ['ڈیڑھ'] },
  { value: 2.5, roman: ['dhaai', 'dhai', 'dhaee'], urdu: ['ڈھائی'] },
];

/** Prefixes to "N sau": sawa do sau = (2 + 0.25) × 100. */
const PREFIX_FRACTIONS: ReadonlyArray<{ offset: number; roman: string[]; urdu: string[] }> = [
  { offset: 0.25, roman: ['sawa', 'sava'], urdu: ['سوا'] },
  { offset: 0.5, roman: ['sarhe', 'sadhe', 'saade', 'sare'], urdu: ['ساڑھے'] },
  { offset: -0.25, roman: ['paune', 'pone', 'pauney'], urdu: ['پونے'] },
];

export const MAX_NUMBER_WORD_VALUE = 500;

export type NumberToken =
  | { kind: 'unit'; value: number }
  | { kind: 'hundred' }
  | { kind: 'whole_fraction'; value: number }
  | { kind: 'prefix_fraction'; offset: number };

interface Lookup {
  token: NumberToken;
  /** True when matched on a phonetic key rather than a listed spelling. */
  phonetic: boolean;
}

const MIN_PHONETIC_KEY_LENGTH = 3;

const literal = new Map<string, NumberToken>();
const phonetic = new Map<string, NumberToken>();

function addLiteral(spelling: string, token: NumberToken): void {
  const existing = literal.get(spelling);
  if (existing && JSON.stringify(existing) !== JSON.stringify(token)) {
    throw new Error(`Number word "${spelling}" is listed for two values`);
  }
  literal.set(spelling, token);
}

function buildIndexes(): void {
  const romanEntries: Array<[string, NumberToken]> = [];

  ROMAN_1_TO_99.forEach((spellings, value) => {
    if (!spellings) return;
    for (const spelling of spellings.split('|')) romanEntries.push([spelling, { kind: 'unit', value }]);
  });
  URDU_1_TO_99.forEach((spelling, value) => {
    if (spelling) addLiteral(normalizeUrdu(spelling), { kind: 'unit', value });
  });

  for (const spelling of HUNDRED.roman) romanEntries.push([spelling, { kind: 'hundred' }]);
  for (const spelling of HUNDRED.urdu) addLiteral(normalizeUrdu(spelling), { kind: 'hundred' });

  for (const { value, roman, urdu } of WHOLE_FRACTIONS) {
    for (const spelling of roman) romanEntries.push([spelling, { kind: 'whole_fraction', value }]);
    for (const spelling of urdu) addLiteral(normalizeUrdu(spelling), { kind: 'whole_fraction', value });
  }
  for (const { offset, roman, urdu } of PREFIX_FRACTIONS) {
    for (const spelling of roman) romanEntries.push([spelling, { kind: 'prefix_fraction', offset }]);
    for (const spelling of urdu) addLiteral(normalizeUrdu(spelling), { kind: 'prefix_fraction', offset });
  }

  // Phonetic keys, dropping every key that more than one value claims.
  const claims = new Map<string, Set<string>>();
  for (const [spelling, token] of romanEntries) {
    addLiteral(spelling, token);
    const key = romanKey(spelling);
    if (key.length < MIN_PHONETIC_KEY_LENGTH) continue;
    const owners = claims.get(key) ?? new Set<string>();
    owners.add(JSON.stringify(token));
    claims.set(key, owners);
  }
  for (const [key, owners] of claims) {
    if (owners.size === 1) phonetic.set(key, JSON.parse([...owners][0]) as NumberToken);
  }
}

buildIndexes();

export function lookupNumberWord(word: string): Lookup | null {
  const normalized = normalizeUrdu(word).toLowerCase();
  const exact = literal.get(normalized);
  if (exact) return { token: exact, phonetic: false };

  if (!/^[a-z]+$/.test(normalized)) return null;
  const key = romanKey(normalized);
  const match = phonetic.get(key);
  return match ? { token: match, phonetic: true } : null;
}

export interface NumberWordsResult {
  value: number;
  /** True when any word was matched phonetically, so the user should confirm it. */
  phonetic: boolean;
}

/**
 * Reads a run of number words as one number, or returns null if the words do not
 * form exactly one number in 1–500. Never guesses at a partial match.
 */
export function parseNumberWords(words: readonly string[]): NumberWordsResult | null {
  if (words.length === 0) return null;

  const lookups = words.map(lookupNumberWord);
  if (lookups.some((lookup) => lookup === null)) return null;

  const tokens = (lookups as Lookup[]).map((lookup) => lookup.token);
  const usedPhonetic = (lookups as Lookup[]).some((lookup) => lookup.phonetic);

  const value = composeNumber(tokens);
  if (value === null || !Number.isInteger(value) || value < 1 || value > MAX_NUMBER_WORD_VALUE) {
    return null;
  }
  return { value, phonetic: usedPhonetic };
}

function composeNumber(tokens: readonly NumberToken[]): number | null {
  const [first, second, third] = tokens;

  // N (1–99)
  if (tokens.length === 1 && first.kind === 'unit') return first.value;

  // sau | sau M
  if (first.kind === 'hundred') {
    if (tokens.length === 1) return 100;
    if (tokens.length === 2 && second.kind === 'unit') return 100 + second.value;
    return null;
  }

  // dedh sau | dhaai sau
  if (first.kind === 'whole_fraction') {
    return tokens.length === 2 && second.kind === 'hundred' ? first.value * 100 : null;
  }

  // sawa / sarhe / paune N sau
  if (first.kind === 'prefix_fraction') {
    if (tokens.length === 3 && second.kind === 'unit' && second.value <= 9 && third.kind === 'hundred') {
      return (second.value + first.offset) * 100;
    }
    return null;
  }

  // N sau | N sau M, N a single digit
  if (first.kind === 'unit' && first.value <= 9 && second?.kind === 'hundred') {
    if (tokens.length === 2) return first.value * 100;
    if (tokens.length === 3 && third.kind === 'unit') return first.value * 100 + third.value;
    return null;
  }

  return null;
}
