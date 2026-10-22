/**
 * Reads a glucose reading out of what the patient typed or said: "sugar 62",
 * "sugar baasath hai", "شوگر ۶۲", "4.1 mmol".
 *
 * Deterministic first. The model is only asked when the text has no number this
 * module can read, or more than one, and anything it returns comes back with
 * `needsConfirmation: true` so the patient confirms the number before it is used.
 *
 * Words are only read as a number when every other word in the text is one this
 * module knows ("sugar", "hai", "meri", a unit). Without that, "do" in "I do feel
 * shaky" is 2, and a reading of 2 is an emergency.
 */

import { z } from 'zod';
import { normalizeUrdu } from '../nlp/urdu';
import { getGroq, MODELS } from '@/lib/groq';
import { parseNumberWords } from './number-words';
import { toMgDl, type GlucoseUnit } from './glucose-rules';

/**
 * Glucometers display roughly 20–600 mg/dL (1.1–33.3 mmol/L) and show LO or HI
 * outside it. A number outside that range is a misreading, not a reading.
 */
const METER_RANGE = {
  mg_dl: { min: 20, max: 600 },
  mmol_l: { min: 1.1, max: 33.3 },
} as const;

/**
 * Below this, an integer with no unit could be either: 30 mg/dL is a dangerous low and
 * 30 mmol/L is a dangerous high, and the advice for the two is opposite. Above it, no
 * mmol/L reading exists, so the unit is mg/dL — which is what meters sold in Pakistan
 * display.
 */
const UNITLESS_MG_DL_FROM = 40;

export type GlucoseParseResult =
  | {
      ok: true;
      value: number;
      unit: GlucoseUnit;
      valueMgDl: number;
      needsConfirmation: boolean;
      method: 'digits' | 'words' | 'llm';
    }
  | {
      ok: false;
      reason: 'no_number' | 'multiple_numbers' | 'ambiguous_unit' | 'out_of_range';
      value?: number;
    };

/** Words that may surround a reading without changing it. Compared after normalizeUrdu. */
const FILLER_WORDS = new Set(
  [
    'sugar', 'shugar', 'suger', 'glucose', 'blood', 'bsr', 'bsf', 'bs', 'rbs', 'fbs', 'level', 'reading',
    'meri', 'mera', 'mere', 'hai', 'he', 'ha', 'hy', 'h', 'thi', 'tha', 'aaj', 'aj', 'abhi', 'ab', 'ki',
    'ka', 'ke', 'aayi', 'aai', 'ayi', 'check', 'my', 'is', 'was', 'the', 'it', 'its', 'now', 'today',
    'شوگر', 'میری', 'میرا', 'ہے', 'تھی', 'تھا', 'آج', 'ابھی', 'لیول', 'ریڈنگ', 'کی', 'کا', 'کے', 'خون',
    'میں', 'شکر', 'آئی', 'چیک',
  ].map((word) => normalizeUrdu(word).toLowerCase())
);

const MMOL_PATTERN = /\bmmol(?:\/l|l)?\b|ملی\s?مول/;
const MG_PATTERN = /\bmg(?:\/dl|dl|%)?\b|\bdl\b|ملی\s?گرام/;

function isUnitWord(word: string): boolean {
  return MMOL_PATTERN.test(word) || MG_PATTERN.test(word) || ['l', 'per', 'ملی', 'گرام', 'مول'].includes(word);
}

function detectUnit(text: string): GlucoseUnit | null {
  if (MMOL_PATTERN.test(text)) return 'mmol_l';
  if (MG_PATTERN.test(text)) return 'mg_dl';
  return null;
}

function tokenize(text: string): string[] {
  return normalizeUrdu(text)
    .toLowerCase()
    .replace(/٫/g, '.')
    // "62mg" and "mg62" are a number and a unit.
    .replace(/(\d)([a-z؀-ۿ])/g, '$1 $2')
    .replace(/([a-z؀-ۿ])(\d)/g, '$1 $2')
    .replace(/[,;:!?()[\]"'`،؛؟۔]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}

function finish(
  value: number,
  explicitUnit: GlucoseUnit | null,
  method: 'digits' | 'words' | 'llm',
  confirm: boolean
): GlucoseParseResult {
  let unit = explicitUnit;
  let needsConfirmation = confirm;

  if (!unit) {
    if (!Number.isInteger(value)) {
      // mg/dL meters do not show decimals; mmol/L ones do.
      unit = 'mmol_l';
      needsConfirmation = true;
    } else if (value >= UNITLESS_MG_DL_FROM) {
      unit = 'mg_dl';
    } else {
      return { ok: false, reason: 'ambiguous_unit', value };
    }
  }

  const range = METER_RANGE[unit];
  if (value < range.min || value > range.max) {
    return { ok: false, reason: 'out_of_range', value };
  }

  return { ok: true, value, unit, valueMgDl: toMgDl(value, unit), needsConfirmation, method };
}

/** The deterministic reader. No network, no model. */
export function parseGlucoseText(text: string): GlucoseParseResult {
  const words = tokenize(text);
  const unit = detectUnit(words.join(' '));

  const numbers = words.filter((word) => /^\d+(?:\.\d+)?$/.test(word));
  if (numbers.length > 1) return { ok: false, reason: 'multiple_numbers' };
  if (numbers.length === 1) return finish(Number(numbers[0]), unit, 'digits', false);

  const remaining = words.filter((word) => !FILLER_WORDS.has(word) && !isUnitWord(word));
  if (remaining.length === 0) return { ok: false, reason: 'no_number' };

  const parsed = parseNumberWords(remaining);
  if (!parsed) return { ok: false, reason: 'no_number' };

  return finish(parsed.value, unit, 'words', parsed.phonetic);
}

// ── Model fallback ──────────────────────────────────────────────────────────

const llmReadingSchema = z.object({
  value: z.number().positive().nullable(),
  unit: z.enum(['mg_dl', 'mmol_l']).nullable(),
});

export type LlmReading = z.infer<typeof llmReadingSchema>;

export type ReadingExtractor = (text: string) => Promise<LlmReading>;

const EXTRACTOR_PROMPT = `The user is logging a blood glucose reading, in English, Urdu or Roman Urdu. Return JSON: {"value": number | null, "unit": "mg_dl" | "mmol_l" | null}.

Rules:
- value is the glucose reading the user states, converted from words to digits if needed.
- unit is only set if the user states it. Do not infer it.
- If there is no glucose reading, or more than one and it is unclear which is the reading, return {"value": null, "unit": null}.
- Never invent a number.`;

async function groqExtractor(text: string): Promise<LlmReading> {
  const response = await getGroq().chat.completions.create({
    model: MODELS.fast,
    messages: [
      { role: 'system', content: EXTRACTOR_PROMPT },
      { role: 'user', content: text },
    ],
    temperature: 0,
    max_tokens: 100,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('Empty response from glucose extractor');

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error('Glucose extractor returned malformed JSON');
  }
  return llmReadingSchema.parse(raw);
}

/**
 * Deterministic parse, then the model only for text that has no readable number or
 * several. An ambiguous unit or an out-of-range number is the patient's to resolve,
 * not the model's, so those are returned as they are.
 */
export async function parseGlucose(
  text: string,
  extract: ReadingExtractor = groqExtractor
): Promise<GlucoseParseResult> {
  const deterministic = parseGlucoseText(text);
  if (deterministic.ok) return deterministic;
  if (deterministic.reason !== 'no_number' && deterministic.reason !== 'multiple_numbers') {
    return deterministic;
  }
  if (!text.trim()) return deterministic;

  const reading = llmReadingSchema.parse(await extract(text));
  if (reading.value === null) return deterministic;

  // The model's value goes through the same unit and range rules, and always needs
  // the patient to confirm it.
  return finish(reading.value, reading.unit, 'llm', true);
}
