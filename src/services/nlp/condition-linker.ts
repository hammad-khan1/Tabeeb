/**
 * Entity linking for conditions: the same disease written five ways collapses to one
 * concept with one ICD-10 code.
 *
 * Diagnoses arrive from the extractor exactly as the document wrote them — "DM type
 * II", "T2DM", "diabetes mellitus type 2", "شوگر" — so a patient's history reads as
 * four separate diseases, the doctor's one-look view lists all four, and nothing
 * dedupes across documents. Linking them to a shared concept is what makes that view
 * honest.
 *
 * Like the lab catalogue this is curated rather than a full terminology server: the
 * conditions a Pakistani outpatient record actually contains, with the local names
 * patients use for them. Codes are the common unspecified variant of each concept and
 * are a suggestion for a clinician to confirm — never a billing code, and never
 * presented to the patient as a diagnosis.
 *
 * Offline and deterministic: no UMLS licence, no API key, no network call.
 */

import { normalizeUrdu, lookupMedicalTerm } from './urdu';

export interface ConditionConcept {
  /** ICD-10-CM code for the unspecified form of this concept. */
  icd10: string;
  /** The name the app stores and displays. */
  canonical: string;
  category: string;
  /** English spellings and abbreviations seen on real documents. */
  aliases: string[];
}

export type MatchKind = 'canonical' | 'alias' | 'local-language' | 'partial';

export interface ConditionLink {
  concept: ConditionConcept;
  matchedOn: MatchKind;
  /** 0-1. Only the top two kinds are confident enough to write a code from. */
  confidence: number;
}

const CONFIDENCE: Record<MatchKind, number> = {
  canonical: 1,
  alias: 0.95,
  'local-language': 0.85,
  partial: 0.6,
};

/** Below this, a link is informational only and must not fill in an ICD-10 code. */
export const MIN_CODING_CONFIDENCE = 0.85;

// ── Input normalisation ─────────────────────────────────────────────────────

/**
 * Wrappers that carry no diagnostic content. Stripping them is what lets "known case
 * of uncontrolled type II DM" reach the same key as "type 2 dm".
 */
const QUALIFIERS =
  /\b(?:known case of|known|k\/c\/o|diagnosed(?: with)?|history of|h\/o|c\/o|complains? of|suspected|probable|possible|uncontrolled|controlled|poorly controlled|newly diagnosed|old|longstanding|mild|moderate|severe|stage \w+|grade \w+|left|right|bilateral|primary|secondary|essential)\b/g;

const ROMAN_NUMERALS: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4' };

export function normalizeConditionName(raw: string): string {
  let text = normalizeUrdu(raw).toLowerCase();

  // Qualifiers are stripped on both sides of punctuation removal: "h/o" only matches
  // while the slash is still there, and "(essential)" only once the brackets are gone.
  text = text.replace(QUALIFIERS, ' ');
  text = text.replace(/[(),.;:'"\[\]{}]/g, ' ').replace(/[-–—/]/g, ' ');
  text = text.replace(QUALIFIERS, ' ');

  text = text
    .split(/\s+/)
    .map((word) => ROMAN_NUMERALS[word] ?? word)
    .filter(Boolean)
    .join(' ');

  return text.trim();
}

// ── Catalogue ───────────────────────────────────────────────────────────────

export const CONDITION_CATALOGUE: ConditionConcept[] = [
  // Endocrine and metabolic
  { icd10: 'E11.9', canonical: 'Type 2 diabetes mellitus', category: 'Endocrine', aliases: ['type 2 diabetes', 'diabetes mellitus type 2', 't2dm', 'dm type 2', 'dm2', 'niddm', 'diabetes', 'diabetes mellitus', 'dm'] },
  { icd10: 'E10.9', canonical: 'Type 1 diabetes mellitus', category: 'Endocrine', aliases: ['type 1 diabetes', 'diabetes mellitus type 1', 't1dm', 'dm type 1', 'iddm', 'juvenile diabetes'] },
  { icd10: 'O24.419', canonical: 'Gestational diabetes', category: 'Endocrine', aliases: ['gdm', 'diabetes in pregnancy'] },
  { icd10: 'R73.03', canonical: 'Prediabetes', category: 'Endocrine', aliases: ['impaired glucose tolerance', 'igt', 'impaired fasting glucose'] },
  { icd10: 'E16.2', canonical: 'Hypoglycemia', category: 'Endocrine', aliases: ['low blood sugar', 'hypoglycaemia'] },
  { icd10: 'E03.9', canonical: 'Hypothyroidism', category: 'Endocrine', aliases: ['underactive thyroid', 'hypothyroid'] },
  { icd10: 'E05.90', canonical: 'Hyperthyroidism', category: 'Endocrine', aliases: ['thyrotoxicosis', 'overactive thyroid', 'hyperthyroid', 'graves disease'] },
  { icd10: 'E04.9', canonical: 'Goiter', category: 'Endocrine', aliases: ['goitre', 'thyroid swelling'] },
  { icd10: 'E78.5', canonical: 'Hyperlipidemia', category: 'Endocrine', aliases: ['dyslipidemia', 'high cholesterol', 'hypercholesterolemia', 'raised lipids', 'hyperlipidaemia'] },
  { icd10: 'E28.2', canonical: 'Polycystic ovary syndrome', category: 'Endocrine', aliases: ['pcos', 'pcod', 'polycystic ovarian disease'] },
  { icd10: 'E66.9', canonical: 'Obesity', category: 'Endocrine', aliases: ['overweight', 'raised bmi'] },
  { icd10: 'E55.9', canonical: 'Vitamin D deficiency', category: 'Endocrine', aliases: ['low vitamin d', 'hypovitaminosis d'] },
  { icd10: 'E53.8', canonical: 'Vitamin B12 deficiency', category: 'Endocrine', aliases: ['b12 deficiency', 'low b12', 'cobalamin deficiency'] },

  // Cardiovascular
  { icd10: 'I10', canonical: 'Hypertension', category: 'Cardiovascular', aliases: ['high blood pressure', 'htn', 'raised blood pressure', 'essential hypertension', 'high bp'] },
  { icd10: 'I25.10', canonical: 'Coronary artery disease', category: 'Cardiovascular', aliases: ['cad', 'ischemic heart disease', 'ihd', 'ischaemic heart disease'] },
  { icd10: 'I21.9', canonical: 'Acute myocardial infarction', category: 'Cardiovascular', aliases: ['heart attack', 'mi', 'myocardial infarction', 'stemi', 'nstemi'] },
  { icd10: 'I20.9', canonical: 'Angina pectoris', category: 'Cardiovascular', aliases: ['angina', 'chest pain on exertion'] },
  { icd10: 'I50.9', canonical: 'Heart failure', category: 'Cardiovascular', aliases: ['ccf', 'chf', 'congestive cardiac failure', 'cardiac failure'] },
  { icd10: 'I48.91', canonical: 'Atrial fibrillation', category: 'Cardiovascular', aliases: ['af', 'afib', 'a fib'] },
  { icd10: 'I63.9', canonical: 'Stroke', category: 'Cardiovascular', aliases: ['cva', 'cerebrovascular accident', 'cerebral infarction', 'brain attack'] },

  // Respiratory
  { icd10: 'J45.909', canonical: 'Asthma', category: 'Respiratory', aliases: ['bronchial asthma', 'reactive airway disease'] },
  { icd10: 'J44.9', canonical: 'Chronic obstructive pulmonary disease', category: 'Respiratory', aliases: ['copd', 'chronic bronchitis emphysema', 'cold lung disease'] },
  { icd10: 'J18.9', canonical: 'Pneumonia', category: 'Respiratory', aliases: ['chest infection', 'lower respiratory tract infection', 'lrti'] },
  { icd10: 'J40', canonical: 'Bronchitis', category: 'Respiratory', aliases: ['acute bronchitis'] },
  { icd10: 'J01.90', canonical: 'Acute sinusitis', category: 'Respiratory', aliases: ['sinusitis', 'sinus infection'] },
  { icd10: 'J30.9', canonical: 'Allergic rhinitis', category: 'Respiratory', aliases: ['hay fever', 'nasal allergy'] },
  { icd10: 'A15.0', canonical: 'Pulmonary tuberculosis', category: 'Infectious', aliases: ['tb', 'ptb', 'tuberculosis', 'koch disease', 'pulmonary tb'] },
  { icd10: 'U07.1', canonical: 'COVID-19', category: 'Infectious', aliases: ['covid', 'sars cov 2', 'corona'] },

  // Infectious (locally common)
  { icd10: 'A01.00', canonical: 'Typhoid fever', category: 'Infectious', aliases: ['typhoid', 'enteric fever'] },
  { icd10: 'B54', canonical: 'Malaria', category: 'Infectious', aliases: ['plasmodium infection'] },
  { icd10: 'A90', canonical: 'Dengue fever', category: 'Infectious', aliases: ['dengue', 'breakbone fever'] },
  { icd10: 'A09', canonical: 'Gastroenteritis', category: 'Infectious', aliases: ['stomach infection', 'food poisoning', 'infectious diarrhea', 'loose motions'] },
  { icd10: 'B18.1', canonical: 'Chronic hepatitis B', category: 'Infectious', aliases: ['hepatitis b', 'hbv', 'hbsag positive'] },
  { icd10: 'B18.2', canonical: 'Chronic hepatitis C', category: 'Infectious', aliases: ['hepatitis c', 'hcv', 'anti hcv positive'] },
  { icd10: 'B15.9', canonical: 'Hepatitis A', category: 'Infectious', aliases: ['hav'] },

  // Renal and urinary
  { icd10: 'N18.9', canonical: 'Chronic kidney disease', category: 'Renal', aliases: ['ckd', 'chronic renal failure', 'crf', 'renal insufficiency'] },
  { icd10: 'N39.0', canonical: 'Urinary tract infection', category: 'Renal', aliases: ['uti', 'urine infection', 'cystitis'] },
  { icd10: 'N20.0', canonical: 'Kidney stones', category: 'Renal', aliases: ['renal calculus', 'nephrolithiasis', 'renal stone', 'kidney stone'] },
  { icd10: 'N40.0', canonical: 'Benign prostatic hyperplasia', category: 'Renal', aliases: ['bph', 'enlarged prostate'] },

  // Gastrointestinal and hepatic
  { icd10: 'K21.9', canonical: 'Gastroesophageal reflux disease', category: 'Gastrointestinal', aliases: ['gerd', 'gord', 'acid reflux', 'reflux'] },
  { icd10: 'K29.70', canonical: 'Gastritis', category: 'Gastrointestinal', aliases: ['acid peptic disease', 'apd', 'stomach inflammation'] },
  { icd10: 'K27.9', canonical: 'Peptic ulcer', category: 'Gastrointestinal', aliases: ['gastric ulcer', 'duodenal ulcer', 'stomach ulcer'] },
  { icd10: 'K58.9', canonical: 'Irritable bowel syndrome', category: 'Gastrointestinal', aliases: ['ibs', 'spastic colon'] },
  { icd10: 'K76.0', canonical: 'Fatty liver', category: 'Gastrointestinal', aliases: ['hepatic steatosis', 'nafld', 'fatty liver disease'] },
  { icd10: 'K74.60', canonical: 'Cirrhosis of liver', category: 'Gastrointestinal', aliases: ['liver cirrhosis', 'cld', 'chronic liver disease'] },
  { icd10: 'K80.20', canonical: 'Gallstones', category: 'Gastrointestinal', aliases: ['cholelithiasis', 'gall bladder stones', 'gallstone'] },
  { icd10: 'K35.80', canonical: 'Acute appendicitis', category: 'Gastrointestinal', aliases: ['appendicitis'] },
  { icd10: 'R17', canonical: 'Jaundice', category: 'Gastrointestinal', aliases: ['icterus', 'yellow discoloration'] },

  // Blood
  { icd10: 'D50.9', canonical: 'Iron deficiency anemia', category: 'Hematology', aliases: ['ida', 'iron deficiency anaemia', 'low iron anemia'] },
  { icd10: 'D64.9', canonical: 'Anemia', category: 'Hematology', aliases: ['anaemia', 'low hemoglobin', 'low haemoglobin'] },
  { icd10: 'D56.9', canonical: 'Thalassemia', category: 'Hematology', aliases: ['thalassaemia', 'thal trait', 'thalassemia minor'] },
  { icd10: 'D57.1', canonical: 'Sickle cell disease', category: 'Hematology', aliases: ['sickle cell anemia', 'scd'] },

  // Neurology and mental health
  { icd10: 'G43.909', canonical: 'Migraine', category: 'Neurology', aliases: ['migraine headache', 'hemicrania'] },
  { icd10: 'G40.909', canonical: 'Epilepsy', category: 'Neurology', aliases: ['seizure disorder', 'fits', 'convulsions'] },
  { icd10: 'G47.00', canonical: 'Insomnia', category: 'Neurology', aliases: ['sleeplessness', 'sleep disorder'] },
  { icd10: 'G62.9', canonical: 'Peripheral neuropathy', category: 'Neurology', aliases: ['neuropathy', 'polyneuropathy', 'nerve damage'] },
  { icd10: 'F32.9', canonical: 'Depressive disorder', category: 'Mental health', aliases: ['depression', 'major depressive disorder', 'mdd'] },
  { icd10: 'F41.9', canonical: 'Anxiety disorder', category: 'Mental health', aliases: ['anxiety', 'generalized anxiety disorder', 'gad'] },

  // Musculoskeletal
  { icd10: 'M19.90', canonical: 'Osteoarthritis', category: 'Musculoskeletal', aliases: ['oa', 'degenerative joint disease', 'arthritis'] },
  { icd10: 'M06.9', canonical: 'Rheumatoid arthritis', category: 'Musculoskeletal', aliases: ['ra', 'rheumatoid'] },
  { icd10: 'M10.9', canonical: 'Gout', category: 'Musculoskeletal', aliases: ['gouty arthritis', 'high uric acid arthritis'] },
  { icd10: 'M81.0', canonical: 'Osteoporosis', category: 'Musculoskeletal', aliases: ['thin bones', 'low bone density'] },
  { icd10: 'M54.50', canonical: 'Low back pain', category: 'Musculoskeletal', aliases: ['backache', 'lumbago', 'back pain'] },

  // Eye, ear, skin
  { icd10: 'H26.9', canonical: 'Cataract', category: 'Ophthalmology', aliases: ['lens opacity'] },
  { icd10: 'H40.9', canonical: 'Glaucoma', category: 'Ophthalmology', aliases: ['raised intraocular pressure'] },
  { icd10: 'H66.90', canonical: 'Otitis media', category: 'ENT', aliases: ['middle ear infection', 'ear infection'] },
  { icd10: 'L30.9', canonical: 'Dermatitis', category: 'Dermatology', aliases: ['eczema', 'skin inflammation'] },
  { icd10: 'L20.9', canonical: 'Atopic dermatitis', category: 'Dermatology', aliases: ['atopic eczema'] },
  { icd10: 'L40.9', canonical: 'Psoriasis', category: 'Dermatology', aliases: ['psoriatic skin disease'] },
];

// ── Index ───────────────────────────────────────────────────────────────────

interface IndexEntry {
  concept: ConditionConcept;
  kind: MatchKind;
}

const exactIndex = new Map<string, IndexEntry>();
/** Alias token sets, longest first, for the partial pass. */
const tokenIndex: Array<{ concept: ConditionConcept; tokens: string[] }> = [];

/**
 * Abbreviations are ambiguous out of context, so a partial match may never be decided
 * by one of them alone — "af" appears inside plenty of prose that is not fibrillation.
 */
const MIN_SINGLE_TOKEN_LENGTH = 4;

/** Beyond this the input is prose, not a diagnosis label, and partial matching stops. */
const MAX_PARTIAL_TOKENS = 10;

for (const concept of CONDITION_CATALOGUE) {
  const canonicalKey = normalizeConditionName(concept.canonical);
  if (canonicalKey && !exactIndex.has(canonicalKey)) {
    exactIndex.set(canonicalKey, { concept, kind: 'canonical' });
  }

  for (const alias of [concept.canonical, ...concept.aliases]) {
    const key = normalizeConditionName(alias);
    if (!key) continue;
    if (!exactIndex.has(key)) exactIndex.set(key, { concept, kind: 'alias' });

    const tokens = key.split(/\s+/).filter(Boolean);
    const usable = tokens.length > 1 || tokens[0].length >= MIN_SINGLE_TOKEN_LENGTH;
    if (usable) tokenIndex.push({ concept, tokens });
  }
}

tokenIndex.sort((a, b) => b.tokens.length - a.tokens.length);

// ── Matching ────────────────────────────────────────────────────────────────

function matchLocalLanguage(raw: string): ConditionConcept | null {
  const term = lookupMedicalTerm(raw);
  if (!term || (term.kind !== 'condition' && term.kind !== 'symptom')) return null;
  return exactIndex.get(normalizeConditionName(term.english))?.concept ?? null;
}

function matchPartial(tokens: string[]): IndexEntry | null {
  if (tokens.length === 0 || tokens.length > MAX_PARTIAL_TOKENS) return null;

  const present = new Set(tokens);
  // tokenIndex is longest-first, so the first alias fully contained in the input is
  // also the most specific one — "type 2 diabetes" beats bare "diabetes".
  for (const entry of tokenIndex) {
    if (!entry.tokens.every((token) => present.has(token))) continue;
    // Same words in a different order ("type 2 dm" for "dm type 2") is a full match,
    // not a partial one, so it stays confident enough to carry a code.
    const kind: MatchKind = entry.tokens.length === present.size ? 'alias' : 'partial';
    return { concept: entry.concept, kind };
  }
  return null;
}

/**
 * Resolves one written condition to a catalogue concept, or null when nothing in the
 * catalogue fits. Null is the common case for anything specialised, and callers must
 * keep the patient's own wording when it happens.
 */
export function linkCondition(raw: string): ConditionLink | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const key = normalizeConditionName(trimmed);
  if (!key) return null;

  const exact = exactIndex.get(key);
  if (exact) {
    return { concept: exact.concept, matchedOn: exact.kind, confidence: CONFIDENCE[exact.kind] };
  }

  const local = matchLocalLanguage(trimmed);
  if (local) {
    return { concept: local, matchedOn: 'local-language', confidence: CONFIDENCE['local-language'] };
  }

  const partial = matchPartial(key.split(/\s+/).filter(Boolean));
  if (partial) {
    return {
      concept: partial.concept,
      matchedOn: partial.kind,
      confidence: CONFIDENCE[partial.kind],
    };
  }

  return null;
}

export function linkConditions(raws: string[]): Map<string, ConditionLink | null> {
  const result = new Map<string, ConditionLink | null>();
  for (const raw of raws) {
    if (!raw || result.has(raw)) continue;
    result.set(raw, linkCondition(raw));
  }
  return result;
}

/**
 * An ICD-10 code for this condition, or null. A partial match is deliberately not
 * enough to write a code: a wrong code in a health record is worse than no code.
 */
export function suggestIcd10(raw: string): string | null {
  const link = linkCondition(raw);
  if (!link || link.confidence < MIN_CODING_CONFIDENCE) return null;
  return link.concept.icd10;
}

/**
 * The concept name for grouping and deduplication. Falls back to the patient's own
 * wording, which is what the record displays anyway.
 */
export function canonicalConditionName(raw: string): string {
  const link = linkCondition(raw);
  return link ? link.concept.canonical : raw.trim();
}
