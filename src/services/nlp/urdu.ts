/**
 * Urdu and Roman-Urdu handling for the NLP layer.
 *
 * Patients in Pakistan write to this app three ways, often inside one sentence: Urdu
 * script, Roman Urdu, and English. The rest of the stack — the lexical retrieval arm,
 * the assertion detector, the condition linker — is built on matching strings, and
 * none of those matches survives contact with that reality: the Urdu word for sugar
 * shares no characters with "diabetes", and one patient's "khansi" is another's
 * "khaansi".
 *
 * This module is the shared normalisation layer underneath them. It is deterministic
 * and offline — no model, no key, no network call — so it can never be the reason an
 * upload or a question fails.
 *
 * It does NOT translate free text. It maps a curated set of everyday medical words to
 * their English clinical equivalents; anything outside that list is left alone rather
 * than guessed at.
 */

export type Script = 'latin' | 'urdu' | 'mixed' | 'unknown';

export type TermKind = 'condition' | 'symptom' | 'anatomy' | 'medication' | 'lab' | 'general';

export interface MedicalTerm {
  /** English clinical term the local word maps to. */
  english: string;
  kind: TermKind;
  /** Urdu-script spellings, pre-normalisation. */
  urdu: string[];
  /** Roman-Urdu spellings; matched by phonetic key, so one variant is usually enough. */
  roman: string[];
}

// ── Script detection ────────────────────────────────────────────────────────

/** Arabic block plus the Urdu-specific extensions and presentation forms. */
const URDU_CHAR = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN_CHAR = /[A-Za-z]/;

/** Below this share of the letters, a script is incidental rather than present. */
const MIXED_THRESHOLD = 0.15;

export function detectScript(text: string): Script {
  let urdu = 0;
  let latin = 0;

  for (const char of text) {
    if (URDU_CHAR.test(char)) urdu += 1;
    else if (LATIN_CHAR.test(char)) latin += 1;
  }

  const total = urdu + latin;
  if (total === 0) return 'unknown';

  const urduShare = urdu / total;
  if (urduShare >= 1 - MIXED_THRESHOLD) return 'urdu';
  if (urduShare <= MIXED_THRESHOLD) return 'latin';
  return 'mixed';
}

export function containsUrduScript(text: string): boolean {
  return URDU_CHAR.test(text);
}

// ── Urdu-script normalisation ───────────────────────────────────────────────

/** Harakat and other combining marks: optional in writing, so never part of a match. */
const DIACRITICS = /[ً-ٰٕٴۖ-ۭ]/g;

/** Zero-width joiners and bidi controls, which OCR and keyboards both sprinkle in. */
const INVISIBLES = /[​-‏‪-‮⁦-⁩﻿]/g;

/**
 * Arabic and Urdu keyboards produce different codepoints for letters that are the same
 * letter to a reader. Folding them is what lets an Arabic-keyboard yeh match an
 * Urdu-keyboard yeh inside the same word.
 */
const LETTER_FOLDING: Record<string, string> = {
  'ي': 'ی', // ARABIC YEH -> FARSI YEH
  'ى': 'ی', // ALEF MAKSURA -> FARSI YEH
  'ئ': 'ی', // YEH WITH HAMZA -> FARSI YEH
  'ك': 'ک', // ARABIC KAF -> KEHEH
  'ه': 'ہ', // ARABIC HEH -> HEH GOAL
  'ۃ': 'ہ', // TEH MARBUTA GOAL -> HEH GOAL
  'ة': 'ہ', // TEH MARBUTA -> HEH GOAL
  'ؤ': 'و', // WAW WITH HAMZA -> WAW
  'أ': 'ا', // ALEF WITH HAMZA ABOVE -> ALEF
  'إ': 'ا', // ALEF WITH HAMZA BELOW -> ALEF
  'آ': 'ا', // ALEF WITH MADDA -> ALEF
};

/** Both Indic digit ranges appear on Pakistani lab reports; values must compare as numbers. */
const EASTERN_DIGITS: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

/** Urdu punctuation a reader ignores but a string comparison does not. */
const URDU_PUNCTUATION = /[،؛؟۔]/g;

/**
 * Canonical form of Urdu text for comparison. Safe on English too — apart from
 * whitespace collapsing it only touches characters English does not use.
 */
export function normalizeUrdu(text: string): string {
  const stripped = text.normalize('NFC').replace(INVISIBLES, '').replace(DIACRITICS, '');

  const folded = [...stripped]
    .map((char) => LETTER_FOLDING[char] ?? EASTERN_DIGITS[char] ?? char)
    .join('');

  return folded.replace(URDU_PUNCTUATION, ' ').replace(/\s+/g, ' ').trim();
}

/** Digits only — for lab values printed in Urdu numerals inside otherwise English text. */
export function normalizeEasternDigits(text: string): string {
  return [...text].map((char) => EASTERN_DIGITS[char] ?? char).join('');
}

// ── Roman-Urdu phonetic keys ────────────────────────────────────────────────

/**
 * Roman Urdu has no standard orthography: khansi / khaansi / khansee are one word and
 * the writer picks a spelling per message, so matching the literal string fails most
 * of the time.
 *
 * The key below folds the variance that is purely orthographic — aspirated digraphs,
 * doubled letters, q/k and w/v — then drops interior vowels, which are what writers
 * disagree about most. The first character is always kept so words are not collapsed
 * to a bare consonant skeleton.
 *
 * This is deliberately lossy and would be far too aggressive as a general matcher. It
 * is only ever used to look up the curated lexicon below, never to compare two
 * arbitrary words, so a collision costs nothing unless it collides with a listed term.
 */
const DIGRAPHS: Array<[RegExp, string]> = [
  [/ph/g, 'f'],
  [/gh/g, 'g'],
  [/kh/g, 'k'],
  [/sh/g, 's'],
  [/ch/g, 'c'],
  [/th/g, 't'],
  [/dh/g, 'd'],
  [/bh/g, 'b'],
  [/ck/g, 'k'],
  [/q/g, 'k'],
  [/w/g, 'v'],
  [/x/g, 'ks'],
  [/z/g, 'j'],
];

export function romanKey(word: string): string {
  const letters = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!letters) return '';

  let out = letters;
  for (const [pattern, replacement] of DIGRAPHS) out = out.replace(pattern, replacement);

  out = out.replace(/(.)\1+/g, '$1');
  out = out[0] + out.slice(1).replace(/[aeiou]/g, '');
  return out.replace(/(.)\1+/g, '$1');
}

/** Phrase-level key: each word keyed independently so word spacing stays significant. */
function phraseKey(phrase: string): string {
  return phrase.trim().split(/\s+/).map(romanKey).filter(Boolean).join(' ');
}

// ── Curated medical lexicon ─────────────────────────────────────────────────

/**
 * Everyday Urdu and Roman-Urdu medical vocabulary mapped to the English term the rest
 * of the app stores and searches on. The diabetes entry is the one that matters most:
 * "شوگر" is how essentially every Pakistani patient refers to it, and without the
 * mapping a question about their own diabetes retrieves nothing.
 *
 * Limited to words that are unambiguous in a medical document. Anatomical words that
 * double as common metaphors are included because surrounding record text
 * disambiguates them; genuinely ambiguous words are left out.
 */
export const MEDICAL_LEXICON: MedicalTerm[] = [
  // Conditions
  { english: 'diabetes', kind: 'condition', urdu: ['شوگر', 'ذیابیطس'], roman: ['shugar', 'ziabetes'] },
  { english: 'hypertension', kind: 'condition', urdu: ['بلڈ پریشر', 'فشار خون'], roman: ['blood pressure'] },
  { english: 'asthma', kind: 'condition', urdu: ['دمہ'], roman: ['dama'] },
  { english: 'tuberculosis', kind: 'condition', urdu: ['ٹی بی', 'تپ دق'], roman: ['tapedik'] },
  { english: 'jaundice', kind: 'condition', urdu: ['یرقان', 'پیلیا'], roman: ['yarkan', 'pilia'] },
  { english: 'anemia', kind: 'condition', urdu: ['خون کی کمی'], roman: ['khoon ki kami'] },
  { english: 'malaria', kind: 'condition', urdu: ['ملیریا'], roman: ['malaria'] },
  { english: 'dengue', kind: 'condition', urdu: ['ڈینگی'], roman: ['dengue'] },
  { english: 'typhoid', kind: 'condition', urdu: ['ٹائیفائیڈ', 'میعادی بخار'], roman: ['typhoid'] },
  { english: 'hepatitis', kind: 'condition', urdu: ['ہیپاٹائٹس', 'کالا یرقان'], roman: ['hepatitis', 'kala yarkan'] },
  { english: 'allergy', kind: 'condition', urdu: ['الرجی', 'حساسیت'], roman: ['allergy'] },
  { english: 'infection', kind: 'condition', urdu: ['انفیکشن'], roman: ['infection'] },
  { english: 'common cold', kind: 'condition', urdu: ['زکام', 'نزلہ'], roman: ['zukam', 'nazla'] },
  { english: 'kidney stones', kind: 'condition', urdu: ['گردے کی پتھری'], roman: ['pathri'] },
  { english: 'heart attack', kind: 'condition', urdu: ['دل کا دورہ'], roman: ['dil ka dora'] },
  { english: 'pregnancy', kind: 'condition', urdu: ['حمل'], roman: ['hamal'] },
  { english: 'obesity', kind: 'condition', urdu: ['موٹاپا'], roman: ['motapa'] },

  // Symptoms
  { english: 'fever', kind: 'symptom', urdu: ['بخار'], roman: ['bukhar'] },
  { english: 'cough', kind: 'symptom', urdu: ['کھانسی'], roman: ['khansi'] },
  { english: 'pain', kind: 'symptom', urdu: ['درد', 'تکلیف'], roman: ['dard', 'takleef'] },
  { english: 'headache', kind: 'symptom', urdu: ['سر درد', 'سردرد'], roman: ['sar dard'] },
  { english: 'abdominal pain', kind: 'symptom', urdu: ['پیٹ درد'], roman: ['pait dard'] },
  { english: 'chest pain', kind: 'symptom', urdu: ['سینے میں درد'], roman: ['seene mein dard'] },
  { english: 'shortness of breath', kind: 'symptom', urdu: ['سانس کی تکلیف'], roman: ['saans ki takleef'] },
  { english: 'vomiting', kind: 'symptom', urdu: ['قے', 'الٹی'], roman: ['ulti'] },
  { english: 'diarrhea', kind: 'symptom', urdu: ['دست', 'اسہال'], roman: ['ishaal'] },
  { english: 'constipation', kind: 'symptom', urdu: ['قبض'], roman: ['qabz'] },
  { english: 'dizziness', kind: 'symptom', urdu: ['چکر'], roman: ['chakkar'] },
  { english: 'weakness', kind: 'symptom', urdu: ['کمزوری', 'نقاہت'], roman: ['kamzori'] },
  { english: 'swelling', kind: 'symptom', urdu: ['سوجن', 'ورم'], roman: ['sojan'] },
  { english: 'itching', kind: 'symptom', urdu: ['خارش'], roman: ['kharish'] },
  { english: 'sputum', kind: 'symptom', urdu: ['بلغم'], roman: ['balgham'] },
  { english: 'insomnia', kind: 'symptom', urdu: ['بے خوابی'], roman: ['be khwabi'] },

  // Anatomy
  { english: 'heart', kind: 'anatomy', urdu: ['دل', 'قلب'], roman: ['dil'] },
  { english: 'kidney', kind: 'anatomy', urdu: ['گردہ', 'گردے'], roman: ['gurda'] },
  { english: 'liver', kind: 'anatomy', urdu: ['جگر'], roman: ['jigar'] },
  { english: 'lungs', kind: 'anatomy', urdu: ['پھیپھڑے', 'پھیپھڑا'], roman: ['phephray'] },
  { english: 'stomach', kind: 'anatomy', urdu: ['معدہ', 'پیٹ'], roman: ['mayda', 'pait'] },
  { english: 'blood', kind: 'anatomy', urdu: ['خون'], roman: ['khoon'] },
  { english: 'bone', kind: 'anatomy', urdu: ['ہڈی', 'ہڈیاں'], roman: ['haddi'] },
  { english: 'joint', kind: 'anatomy', urdu: ['جوڑ', 'جوڑوں'], roman: ['joron'] },
  { english: 'chest', kind: 'anatomy', urdu: ['سینہ', 'چھاتی'], roman: ['seena', 'chaati'] },
  { english: 'eye', kind: 'anatomy', urdu: ['آنکھ', 'آنکھیں'], roman: ['aankh'] },

  // Labs and measurements
  { english: 'blood sugar', kind: 'lab', urdu: ['خون میں شکر', 'شوگر ٹیسٹ'], roman: ['shugar test'] },
  { english: 'cholesterol', kind: 'lab', urdu: ['کولیسٹرول', 'چربی'], roman: ['cholesterol'] },
  { english: 'thyroid', kind: 'lab', urdu: ['تھائیرائیڈ'], roman: ['thyroid'] },
  { english: 'weight', kind: 'lab', urdu: ['وزن'], roman: ['wazan'] },
  { english: 'test', kind: 'lab', urdu: ['ٹیسٹ', 'معائنہ', 'جانچ'], roman: ['muaina'] },
  { english: 'report', kind: 'lab', urdu: ['رپورٹ'], roman: ['report'] },

  // Medications and care
  { english: 'medicine', kind: 'medication', urdu: ['دوا', 'دوائی', 'ادویات'], roman: ['dawai'] },
  { english: 'tablet', kind: 'medication', urdu: ['گولی', 'ٹیبلٹ'], roman: ['goli'] },
  { english: 'syrup', kind: 'medication', urdu: ['شربت'], roman: ['sharbat'] },
  { english: 'injection', kind: 'medication', urdu: ['ٹیکہ', 'انجکشن'], roman: ['teeka'] },
  { english: 'dose', kind: 'medication', urdu: ['خوراک', 'مقدار'], roman: ['khurak'] },
  { english: 'prescription', kind: 'medication', urdu: ['نسخہ'], roman: ['nuskha'] },

  // General
  { english: 'doctor', kind: 'general', urdu: ['ڈاکٹر', 'طبیب'], roman: ['tabeeb'] },
  { english: 'hospital', kind: 'general', urdu: ['ہسپتال', 'شفاخانہ'], roman: ['haspatal'] },
  { english: 'patient', kind: 'general', urdu: ['مریض'], roman: ['mareez'] },
  { english: 'treatment', kind: 'general', urdu: ['علاج'], roman: ['ilaj'] },
  { english: 'operation', kind: 'general', urdu: ['آپریشن', 'جراحی'], roman: ['operation'] },
  { english: 'smoking', kind: 'general', urdu: ['سگریٹ', 'تمباکو'], roman: ['tambaku'] },
];

// ── Lookup ──────────────────────────────────────────────────────────────────

/** Longest phrase in the lexicon, in words — the look-ahead window the scanner needs. */
const MAX_TERM_WORDS = Math.max(
  ...MEDICAL_LEXICON.flatMap((term) => [...term.urdu, ...term.roman]).map(
    (phrase) => phrase.trim().split(/\s+/).length
  )
);

/**
 * Roman keys shorter than this are dropped from the index: a two-character skeleton
 * collides with far too much ordinary English to be safe to match on.
 */
const MIN_ROMAN_KEY_LENGTH = 3;

const urduIndex = new Map<string, MedicalTerm>();
const romanIndex = new Map<string, MedicalTerm>();

for (const term of MEDICAL_LEXICON) {
  for (const spelling of term.urdu) {
    const key = normalizeUrdu(spelling);
    if (key && !urduIndex.has(key)) urduIndex.set(key, term);
  }
  for (const spelling of term.roman) {
    const key = phraseKey(spelling);
    if (key.replace(/\s/g, '').length >= MIN_ROMAN_KEY_LENGTH && !romanIndex.has(key)) {
      romanIndex.set(key, term);
    }
  }
}

/** Looks up one word or phrase. Returns null rather than guessing. */
export function lookupMedicalTerm(phrase: string): MedicalTerm | null {
  const trimmed = phrase.trim();
  if (!trimmed) return null;

  if (containsUrduScript(trimmed)) {
    return urduIndex.get(normalizeUrdu(trimmed)) ?? null;
  }

  const key = phraseKey(trimmed);
  return key ? romanIndex.get(key) ?? null : null;
}

export interface TermMatch {
  /** The text as it appeared, after normalisation. */
  matched: string;
  english: string;
  kind: TermKind;
}

/**
 * Scans text for lexicon terms, preferring the longest phrase at each position so
 * "خون کی کمی" resolves to anemia rather than to blood followed by two stopwords.
 */
export function findMedicalTerms(text: string): TermMatch[] {
  const words = normalizeUrdu(text).split(/[\s,.;:()/–—-]+/).filter(Boolean);
  const matches: TermMatch[] = [];

  let index = 0;
  while (index < words.length) {
    let consumed = 0;

    for (let span = Math.min(MAX_TERM_WORDS, words.length - index); span >= 1; span -= 1) {
      const term = lookupMedicalTerm(words.slice(index, index + span).join(' '));
      if (term) {
        matches.push({
          matched: words.slice(index, index + span).join(' '),
          english: term.english,
          kind: term.kind,
        });
        consumed = span;
        break;
      }
    }

    index += consumed || 1;
  }

  return matches;
}

/**
 * English terms worth adding to a search alongside the patient's own words. Words that
 * were already written in English contribute nothing and are dropped, so plain-English
 * input returns an empty array and callers can skip expansion entirely.
 */
export function toEnglishTerms(text: string): string[] {
  const seen = new Set<string>();
  for (const match of findMedicalTerms(text)) {
    if (match.matched.toLowerCase() === match.english.toLowerCase()) continue;
    seen.add(match.english);
  }
  return [...seen];
}
