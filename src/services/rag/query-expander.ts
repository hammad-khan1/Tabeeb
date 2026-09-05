/**
 * Query expansion for the lexical retrieval arm.
 *
 * The lexical arm matches words, and a patient and their lab report almost never use
 * the same ones. The report says "HbA1c"; the patient asks about "sugar control". The
 * report says "Blood Pressure"; the patient types "BP". The report is in English; the
 * question is in Urdu. Every one of those is a miss the dense arm has to carry alone,
 * and the dense arm is exactly what struggles with drug names and numbers.
 *
 * So the query — and only the query — is expanded with the clinical vocabulary the
 * document is likely to have used. The patient's own words are always kept: expansion
 * adds terms, it never replaces them, and it never touches the dense arm, whose
 * embedding is computed from what the patient actually wrote.
 *
 * Offline: a curated map plus the Urdu lexicon and the condition catalogue. No model
 * call sits between a question and its answer.
 */

import { normalizeUrdu, normalizeEasternDigits, toEnglishTerms } from '@/services/nlp/urdu';
import { linkCondition, MIN_CODING_CONFIDENCE } from '@/services/nlp/condition-linker';

/**
 * Clinical shorthand mapped to what a document is likely to print, and vice versa.
 * Keys are matched as whole phrases against the normalised query.
 */
const SYNONYMS: Record<string, string[]> = {
  // Vitals and anthropometry
  'bp': ['blood pressure', 'systolic', 'diastolic'],
  'blood pressure': ['bp', 'systolic', 'diastolic', 'hypertension'],
  'pulse': ['heart rate', 'bpm'],
  'bmi': ['body mass index', 'weight'],

  // Glycaemic control — the single most asked-about topic in this app
  'sugar': ['glucose', 'hba1c', 'blood sugar', 'diabetes'],
  'blood sugar': ['glucose', 'fbs', 'rbs', 'bsr', 'hba1c'],
  'hba1c': ['glycated hemoglobin', 'a1c', 'glycosylated hemoglobin', 'blood sugar'],
  'diabetes': ['diabetic', 'hba1c', 'glucose', 'metformin'],
  'fasting': ['fbs', 'fasting blood sugar', 'fasting glucose'],

  // Common panels
  'cbc': ['complete blood count', 'hemoglobin', 'platelets', 'wbc'],
  'complete blood count': ['cbc', 'hemoglobin', 'platelets'],
  'lft': ['liver function test', 'alt', 'ast', 'bilirubin', 'sgpt', 'sgot'],
  'liver function': ['lft', 'alt', 'ast', 'bilirubin'],
  'rft': ['renal function test', 'creatinine', 'urea', 'egfr'],
  'kft': ['kidney function test', 'creatinine', 'urea', 'egfr'],
  'kidney function': ['creatinine', 'urea', 'egfr', 'rft'],
  'thyroid': ['tsh', 't3', 't4', 'thyroid function'],
  'cholesterol': ['lipid profile', 'ldl', 'hdl', 'triglycerides'],
  'lipid': ['cholesterol', 'ldl', 'hdl', 'triglycerides'],

  // Individual analytes patients ask for by nickname
  'hemoglobin': ['hb', 'haemoglobin'],
  'hb': ['hemoglobin', 'haemoglobin'],
  'creatinine': ['serum creatinine', 'kidney function'],
  'uric acid': ['urate', 'gout'],
  'vitamin d': ['25 hydroxy vitamin d', 'vit d'],
  'esr': ['erythrocyte sedimentation rate'],
  'crp': ['c reactive protein'],

  // Imaging
  'x ray': ['xray', 'radiograph', 'chest film'],
  'xray': ['x ray', 'radiograph'],
  'scan': ['ct', 'mri', 'ultrasound', 'imaging'],
  'ultrasound': ['usg', 'sonography'],
  'ct': ['computed tomography', 'ct scan'],
  'mri': ['magnetic resonance', 'mri scan'],

  // Care vocabulary
  'medicine': ['medication', 'drug', 'tablet', 'prescription'],
  'medication': ['medicine', 'drug', 'tablet'],
  'dose': ['dosage', 'mg', 'strength'],
  'allergy': ['allergic', 'hypersensitivity', 'reaction'],
  'doctor': ['physician', 'consultant'],
  'report': ['result', 'findings'],
};

/**
 * Words that carry no retrieval signal. Postgres strips these from the tsquery anyway;
 * they are listed here because the overlap score also runs on this term list, and
 * "my", "have", "is" would otherwise make every chunk look equally relevant.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'my', 'me', 'i', 'you', 'your', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'do',
  'does', 'did', 'have', 'has', 'had', 'what', 'which', 'who', 'whom', 'when', 'where',
  'why', 'how', 'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'any',
  'all', 'some', 'about', 'from', 'that', 'this', 'these', 'those', 'it', 'its', 'as',
  'there', 'here', 'please', 'tell', 'show', 'give', 'know', 'get', 'many', 'much',
  'mujhe', 'mera', 'meri', 'hai', 'hain', 'tha', 'thi', 'ka', 'ki', 'ke', 'ko', 'se',
  'kya', 'kia', 'kitna', 'kitni', 'aur',
]);

/** Enough to cover a question's vocabulary; more just dilutes the tsquery. */
const MAX_ADDED_TERMS = 10;

/** Aliases pulled in per linked condition. All of them would swamp the query. */
const MAX_CONDITION_ALIASES = 2;

export interface ExpandedQuery {
  /** The original query plus the added terms — for the lexical arm only. */
  lexicalQuery: string;
  /** Content terms, original and added, for scoring how well a chunk covers the query. */
  terms: string[];
  /** What expansion contributed, for debugging retrieval. */
  addedTerms: string[];
}

function normalize(text: string): string {
  return normalizeEasternDigits(normalizeUrdu(text))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.%/-]/gu, ' ')
    .replace(/[-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentTerms(text: string): string[] {
  return normalize(text)
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

/** Phrase keys first, so "blood sugar" wins over "sugar" alone. */
const SYNONYM_KEYS = Object.keys(SYNONYMS).sort(
  (a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length
);

function synonymsFor(normalizedQuery: string): string[] {
  const padded = ` ${normalizedQuery} `;
  const added: string[] = [];

  for (const key of SYNONYM_KEYS) {
    if (padded.includes(` ${key} `)) added.push(...SYNONYMS[key]);
  }
  return added;
}

/**
 * Expands a question into the vocabulary the documents are likely to use.
 *
 * Never throws: retrieval is on the critical path for every chat message, and an
 * expansion failure must degrade to the plain query rather than to an error.
 */
export function expandQuery(query: string): ExpandedQuery {
  const original = query.trim();
  const fallback: ExpandedQuery = {
    lexicalQuery: original,
    terms: contentTerms(original),
    addedTerms: [],
  };
  if (!original) return fallback;

  try {
    const normalized = normalize(original);
    const present = new Set(contentTerms(original));
    const candidates: string[] = [];

    // 1. Urdu and Roman-Urdu words, mapped to their English clinical equivalents.
    const localEnglish = toEnglishTerms(original);
    candidates.push(...localEnglish);

    // 2. Clinical shorthand, on the query and on anything step 1 introduced.
    candidates.push(...synonymsFor(normalized));
    for (const term of localEnglish) candidates.push(...synonymsFor(normalize(term)));

    // 3. The catalogue name for a condition the patient named their own way, so a
    //    question about "shugar" also searches for "diabetes mellitus".
    for (const phrase of [original, ...localEnglish]) {
      const link = linkCondition(phrase);
      if (!link || link.confidence < MIN_CODING_CONFIDENCE) continue;
      candidates.push(link.concept.canonical);
      candidates.push(...link.concept.aliases.slice(0, MAX_CONDITION_ALIASES));
    }

    const addedTerms: string[] = [];
    const seen = new Set(present);

    for (const candidate of candidates) {
      for (const word of contentTerms(candidate)) {
        if (seen.has(word)) continue;
        seen.add(word);
        addedTerms.push(word);
        if (addedTerms.length >= MAX_ADDED_TERMS) break;
      }
      if (addedTerms.length >= MAX_ADDED_TERMS) break;
    }

    if (addedTerms.length === 0) return fallback;

    return {
      lexicalQuery: `${original} ${addedTerms.join(' ')}`,
      terms: [...present, ...addedTerms],
      addedTerms,
    };
  } catch (error) {
    console.warn(
      '[QueryExpander] falling back to the plain query:',
      error instanceof Error ? error.message : error
    );
    return fallback;
  }
}

/** Exported for the reranker, which must tokenise chunk text the same way. */
export { contentTerms };
