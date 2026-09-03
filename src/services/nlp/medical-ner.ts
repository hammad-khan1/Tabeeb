/**
 * A second, independent read of the extracted text. The LLM extractor is strong but silently
 * drops entities from noisy handwriting OCR; this layer exists purely to catch those misses so
 * they can be surfaced for patient review rather than lost.
 *
 * Two backends run where available:
 *  - a deterministic clinical pattern recognizer (always on, no network, no key)
 *  - d4data/biomedical-ner-all via HF Inference (only when HF_API_KEY is set)
 */

export type MedicalEntityType = 'medication' | 'condition' | 'lab_test' | 'dosage' | 'frequency';

export interface MedicalEntity {
  text: string;
  type: MedicalEntityType;
  /** 0-1. Rule matches are deterministic; model matches carry the model's own score. */
  score: number;
  source: 'rules' | 'model';
}

const HF_MODEL = 'd4data/biomedical-ner-all';
const HF_ENDPOINT = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`;

/** The model is a BERT with a 512-token window; longer text must be split or it is truncated. */
const HF_MAX_CHARS = 1200;
const HF_TIMEOUT_MS = 15_000;
const MIN_MODEL_SCORE = 0.45;

// ── Deterministic clinical patterns ─────────────────────────────────────────

/** Suffixes shared by drug ingredient names — a cheap, language-agnostic drug detector. */
const DRUG_SUFFIXES =
  /(?:cillin|mycin|micin|cycline|azole|azol|oxacin|floxacin|prazole|sartan|pril|olol|ipine|statin|metformin|glizide|gliptin|formin|dipine|semide|thiazide|parin|zepam|zolam|tidine|setron|profen|codone|caine|tinib|mab|nib)$/i;

const KNOWN_CONDITIONS = [
  'diabetes', 'diabetes mellitus', 'type 2 diabetes', 'type 1 diabetes',
  'hypertension', 'high blood pressure', 'hyperlipidemia', 'dyslipidemia',
  'asthma', 'copd', 'tuberculosis', 'tb', 'pneumonia', 'bronchitis',
  'anemia', 'anaemia', 'thalassemia', 'hepatitis', 'hepatitis b', 'hepatitis c',
  'dengue', 'malaria', 'typhoid', 'gastritis', 'gerd', 'ulcer',
  'hypothyroidism', 'hyperthyroidism', 'thyroid', 'ckd', 'chronic kidney disease',
  'uti', 'urinary tract infection', 'arthritis', 'osteoarthritis',
  'migraine', 'epilepsy', 'depression', 'anxiety', 'obesity',
  'ischemic heart disease', 'myocardial infarction', 'heart failure', 'stroke',
  'fatty liver', 'cirrhosis', 'jaundice', 'polycystic ovary syndrome', 'pcos',
];

const KNOWN_LAB_TESTS = [
  'hba1c', 'fasting blood sugar', 'fbs', 'random blood sugar', 'rbs',
  'blood glucose', 'creatinine', 'urea', 'bun', 'egfr', 'uric acid',
  'cbc', 'hemoglobin', 'haemoglobin', 'hb', 'wbc', 'platelet', 'platelets', 'esr',
  'alt', 'sgpt', 'ast', 'sgot', 'alp', 'bilirubin', 'albumin',
  'cholesterol', 'ldl', 'hdl', 'triglycerides', 'lipid profile',
  'tsh', 't3', 't4', 'ft4', 'vitamin d', 'vitamin b12', 'ferritin',
  'crp', 'd-dimer', 'psa', 'inr', 'pt', 'aptt', 'sodium', 'potassium', 'calcium',
];

const DOSAGE_PATTERN = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|ml|iu|units?)\b/gi;
const FREQUENCY_PATTERN =
  /\b(?:od|bd|bid|tds|tid|qid|qds|hs|sos|prn|stat|once daily|twice daily|thrice daily|three times daily|four times daily|every \d+ hours?)\b/gi;

function buildPhraseMatcher(phrases: string[]): RegExp {
  // Longest-first so "type 2 diabetes" wins over "diabetes".
  const alternatives = [...phrases]
    .sort((a, b) => b.length - a.length)
    .map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

const CONDITION_MATCHER = buildPhraseMatcher(KNOWN_CONDITIONS);
const LAB_MATCHER = buildPhraseMatcher(KNOWN_LAB_TESTS);

function collectMatches(
  text: string,
  pattern: RegExp,
  type: MedicalEntityType,
  score: number
): MedicalEntity[] {
  return [...text.matchAll(pattern)].map((match) => ({
    text: match[0].trim(),
    type,
    score,
    source: 'rules' as const,
  }));
}

function findSuffixDrugs(text: string): MedicalEntity[] {
  const words = text.match(/[\p{L}][\p{L}-]{4,}/gu) ?? [];
  return words
    .filter((word) => DRUG_SUFFIXES.test(word))
    .map((word) => ({
      text: word,
      type: 'medication' as const,
      score: 0.7,
      source: 'rules' as const,
    }));
}

export function extractEntitiesByRules(text: string): MedicalEntity[] {
  return [
    ...findSuffixDrugs(text),
    ...collectMatches(text, CONDITION_MATCHER, 'condition', 0.9),
    ...collectMatches(text, LAB_MATCHER, 'lab_test', 0.9),
    ...collectMatches(text, DOSAGE_PATTERN, 'dosage', 1),
    ...collectMatches(text, FREQUENCY_PATTERN, 'frequency', 1),
  ];
}

// ── HF Inference backend ────────────────────────────────────────────────────

interface HfTokenClassification {
  entity_group?: string;
  entity?: string;
  word?: string;
  score?: number;
}

/** biomedical-ner-all emits 100+ labels; only those that map onto our record are kept. */
const HF_LABEL_MAP: Record<string, MedicalEntityType> = {
  medication: 'medication',
  administration: 'frequency',
  dosage: 'dosage',
  frequency: 'frequency',
  duration: 'frequency',
  diagnostic_procedure: 'lab_test',
  lab_value: 'lab_test',
  disease_disorder: 'condition',
  sign_symptom: 'condition',
  biological_structure: 'condition',
};

function mapHfLabel(label: string | undefined): MedicalEntityType | null {
  if (!label) return null;
  return HF_LABEL_MAP[label.replace(/^[BI]-/, '').toLowerCase()] ?? null;
}

function splitForModel(text: string): string[] {
  const pieces: string[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    for (let start = 0; start < paragraph.length; start += HF_MAX_CHARS) {
      const piece = paragraph.slice(start, start + HF_MAX_CHARS).trim();
      if (piece) pieces.push(piece);
    }
  }
  return pieces;
}

async function classifyWithModel(chunk: string, apiKey: string): Promise<MedicalEntity[]> {
  const response = await fetch(HF_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      inputs: chunk,
      parameters: { aggregation_strategy: 'simple' },
    }),
    signal: AbortSignal.timeout(HF_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HF inference failed (${response.status})`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) return [];

  return (payload as HfTokenClassification[])
    .map((item): MedicalEntity | null => {
      const type = mapHfLabel(item.entity_group ?? item.entity);
      const word = item.word?.trim();
      const score = item.score ?? 0;
      if (!type || !word || score < MIN_MODEL_SCORE) return null;
      return { text: word, type, score, source: 'model' };
    })
    .filter((entity): entity is MedicalEntity => entity !== null);
}

function dedupe(entities: MedicalEntity[]): MedicalEntity[] {
  const best = new Map<string, MedicalEntity>();
  for (const entity of entities) {
    const key = `${entity.type}:${entity.text.toLowerCase()}`;
    const existing = best.get(key);
    if (!existing || entity.score > existing.score) best.set(key, entity);
  }
  return [...best.values()];
}

/**
 * Never throws: NER is an advisory cross-check, so a model or network failure degrades to the
 * rule-based results rather than failing the document.
 */
export async function extractMedicalEntities(text: string): Promise<MedicalEntity[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const ruleEntities = extractEntitiesByRules(trimmed);
  const apiKey = process.env.HF_API_KEY;
  if (!apiKey) return dedupe(ruleEntities);

  try {
    const chunks = splitForModel(trimmed);
    const results = await Promise.all(chunks.map((chunk) => classifyWithModel(chunk, apiKey)));
    return dedupe([...ruleEntities, ...results.flat()]);
  } catch (error) {
    console.warn('[NER] model pass skipped:', error instanceof Error ? error.message : error);
    return dedupe(ruleEntities);
  }
}
