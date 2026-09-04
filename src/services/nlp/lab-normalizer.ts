/**
 * Canonicalizes lab analyte names and units.
 *
 * Trends grouped on the raw lowercased test name, so "HbA1c", "HBA1C", "Hb A1c" and
 * "Glycated Haemoglobin" became four unrelated series and `GET /api/trends` matched
 * on exact string equality, which almost never spanned two documents. Units were
 * never reconciled either, so creatinine in mg/dL and µmol/L would plot on one axis.
 *
 * This is a curated catalogue rather than a LOINC lookup: LOINC's real value is in its
 * codes for exchange, and the local grouping problem is better served by a small,
 * auditable synonym set covering the panels these reports actually contain. Each entry
 * carries a LOINC code where one applies cleanly, so a future exchange path has it.
 */

export interface Analyte {
  /** Stable key used for grouping. */
  key: string;
  /** Display name for charts and tables. */
  display: string;
  loinc?: string;
  /** Unit every value in this series is converted to. */
  canonicalUnit: string | null;
  /**
   * Multipliers into the canonical unit. Only conversions that are exact and
   * unit-only are listed; anything needing molar mass is stated explicitly.
   */
  units?: Record<string, number>;
  synonyms: string[];
}

const CATALOGUE: Analyte[] = [
  {
    key: 'hba1c',
    display: 'HbA1c',
    loinc: '4548-4',
    canonicalUnit: '%',
    units: { '%': 1, percent: 1 },
    synonyms: [
      'hba1c', 'hb a1c', 'a1c', 'glycated hemoglobin', 'glycated haemoglobin',
      'glycosylated hemoglobin', 'glycosylated haemoglobin', 'haemoglobin a1c',
      'hemoglobin a1c',
    ],
  },
  {
    key: 'glucose_fasting',
    display: 'Fasting blood glucose',
    loinc: '1558-6',
    canonicalUnit: 'mg/dL',
    units: { 'mg/dl': 1, 'mg%': 1, 'mmol/l': 18.0182 },
    synonyms: [
      'fasting blood sugar', 'fbs', 'fasting glucose', 'fasting blood glucose',
      'blood sugar fasting', 'bsf', 'glucose fasting', 'sugar fasting',
    ],
  },
  {
    key: 'glucose_random',
    display: 'Random blood glucose',
    loinc: '2345-7',
    canonicalUnit: 'mg/dL',
    units: { 'mg/dl': 1, 'mg%': 1, 'mmol/l': 18.0182 },
    synonyms: [
      'random blood sugar', 'rbs', 'random glucose', 'blood sugar random',
      'bsr', 'glucose random', 'rbg',
    ],
  },
  {
    key: 'creatinine',
    display: 'Creatinine',
    loinc: '2160-0',
    canonicalUnit: 'mg/dL',
    // 1 mg/dL = 88.4 µmol/L for creatinine (MW 113.12).
    units: { 'mg/dl': 1, 'umol/l': 1 / 88.4, 'µmol/l': 1 / 88.4, 'mmol/l': 1000 / 88.4 },
    synonyms: ['creatinine', 's creatinine', 'serum creatinine', 'cr', 'creat'],
  },
  {
    key: 'urea',
    display: 'Urea',
    loinc: '3084-1',
    canonicalUnit: 'mg/dL',
    units: { 'mg/dl': 1, 'mmol/l': 6.006 },
    synonyms: ['urea', 'blood urea', 'serum urea', 'bun', 'blood urea nitrogen'],
  },
  {
    key: 'egfr',
    display: 'eGFR',
    loinc: '33914-3',
    canonicalUnit: 'mL/min/1.73m²',
    synonyms: ['egfr', 'gfr', 'estimated gfr', 'estimated glomerular filtration rate'],
  },
  {
    key: 'uric_acid',
    display: 'Uric acid',
    loinc: '3084-1',
    canonicalUnit: 'mg/dL',
    units: { 'mg/dl': 1, 'umol/l': 1 / 59.48, 'µmol/l': 1 / 59.48 },
    synonyms: ['uric acid', 'serum uric acid', 'urate'],
  },
  {
    key: 'hemoglobin',
    display: 'Hemoglobin',
    loinc: '718-7',
    canonicalUnit: 'g/dL',
    units: { 'g/dl': 1, 'gm/dl': 1, 'g/l': 0.1, 'gms/dl': 1 },
    synonyms: ['hemoglobin', 'haemoglobin', 'hb', 'hgb', 'hb%', 'haemoglobin hb'],
  },
  {
    key: 'wbc',
    display: 'White cell count',
    loinc: '6690-2',
    canonicalUnit: '10^9/L',
    // Lab reports write this as an absolute count (7,500) or already scaled (7.5).
    units: { '10^9/l': 1, 'x10^9/l': 1, '10^3/ul': 1, 'k/ul': 1, '/ul': 0.001, 'cumm': 0.001, '/cumm': 0.001 },
    synonyms: ['wbc', 'white blood cells', 'white cell count', 'tlc', 'total leucocyte count', 'total leukocyte count', 'leucocyte count'],
  },
  {
    key: 'platelets',
    display: 'Platelets',
    loinc: '777-3',
    canonicalUnit: '10^9/L',
    units: { '10^9/l': 1, 'x10^9/l': 1, '10^3/ul': 1, 'lakh/cumm': 10, '/ul': 0.001, 'cumm': 0.001, '/cumm': 0.001 },
    synonyms: ['platelets', 'platelet count', 'plt', 'thrombocyte count'],
  },
  {
    key: 'esr',
    display: 'ESR',
    loinc: '4537-7',
    canonicalUnit: 'mm/hr',
    synonyms: ['esr', 'erythrocyte sedimentation rate', 'sed rate'],
  },
  {
    key: 'alt',
    display: 'ALT (SGPT)',
    loinc: '1742-6',
    canonicalUnit: 'U/L',
    units: { 'u/l': 1, 'iu/l': 1, 'units/l': 1 },
    synonyms: ['alt', 'sgpt', 'alanine aminotransferase', 'alt sgpt', 'sgpt alt'],
  },
  {
    key: 'ast',
    display: 'AST (SGOT)',
    loinc: '1920-8',
    canonicalUnit: 'U/L',
    units: { 'u/l': 1, 'iu/l': 1, 'units/l': 1 },
    synonyms: ['ast', 'sgot', 'aspartate aminotransferase', 'ast sgot', 'sgot ast'],
  },
  {
    key: 'alp',
    display: 'Alkaline phosphatase',
    loinc: '6768-6',
    canonicalUnit: 'U/L',
    units: { 'u/l': 1, 'iu/l': 1 },
    synonyms: ['alp', 'alkaline phosphatase', 'alk phos'],
  },
  {
    key: 'bilirubin_total',
    display: 'Total bilirubin',
    loinc: '1975-2',
    canonicalUnit: 'mg/dL',
    units: { 'mg/dl': 1, 'umol/l': 1 / 17.1, 'µmol/l': 1 / 17.1 },
    synonyms: ['bilirubin', 'total bilirubin', 'bilirubin total', 's bilirubin', 'serum bilirubin'],
  },
  {
    key: 'albumin',
    display: 'Albumin',
    loinc: '1751-7',
    canonicalUnit: 'g/dL',
    units: { 'g/dl': 1, 'g/l': 0.1 },
    synonyms: ['albumin', 'serum albumin', 's albumin'],
  },
  {
    key: 'cholesterol_total',
    display: 'Total cholesterol',
    loinc: '2093-3',
    canonicalUnit: 'mg/dL',
    units: { 'mg/dl': 1, 'mmol/l': 38.67 },
    synonyms: ['cholesterol', 'total cholesterol', 'cholesterol total', 's cholesterol'],
  },
  {
    key: 'ldl',
    display: 'LDL cholesterol',
    loinc: '2089-1',
    canonicalUnit: 'mg/dL',
    units: { 'mg/dl': 1, 'mmol/l': 38.67 },
    synonyms: ['ldl', 'ldl cholesterol', 'ldl c', 'low density lipoprotein'],
  },
  {
    key: 'hdl',
    display: 'HDL cholesterol',
    loinc: '2085-9',
    canonicalUnit: 'mg/dL',
    units: { 'mg/dl': 1, 'mmol/l': 38.67 },
    synonyms: ['hdl', 'hdl cholesterol', 'hdl c', 'high density lipoprotein'],
  },
  {
    key: 'triglycerides',
    display: 'Triglycerides',
    loinc: '2571-8',
    canonicalUnit: 'mg/dL',
    units: { 'mg/dl': 1, 'mmol/l': 88.57 },
    synonyms: ['triglycerides', 'triglyceride', 'tg', 'tgl'],
  },
  {
    key: 'tsh',
    display: 'TSH',
    loinc: '3016-3',
    canonicalUnit: 'mIU/L',
    units: { 'miu/l': 1, 'uiu/ml': 1, 'µiu/ml': 1, 'miu/ml': 1000 },
    synonyms: ['tsh', 'thyroid stimulating hormone', 'thyrotropin'],
  },
  {
    key: 'ft4',
    display: 'Free T4',
    loinc: '3024-7',
    canonicalUnit: 'ng/dL',
    synonyms: ['ft4', 'free t4', 'free thyroxine', 't4 free'],
  },
  {
    key: 't3',
    display: 'T3',
    loinc: '3053-6',
    canonicalUnit: 'ng/dL',
    synonyms: ['t3', 'triiodothyronine', 'total t3'],
  },
  {
    key: 't4',
    display: 'T4',
    loinc: '3026-2',
    canonicalUnit: 'µg/dL',
    synonyms: ['t4', 'thyroxine', 'total t4'],
  },
  {
    key: 'vitamin_d',
    display: 'Vitamin D (25-OH)',
    loinc: '1989-3',
    canonicalUnit: 'ng/mL',
    units: { 'ng/ml': 1, 'nmol/l': 1 / 2.496 },
    synonyms: ['vitamin d', 'vit d', '25 oh vitamin d', '25 hydroxy vitamin d', 'vitamin d3', 'vitamin d 25 oh'],
  },
  {
    key: 'vitamin_b12',
    display: 'Vitamin B12',
    loinc: '2132-9',
    canonicalUnit: 'pg/mL',
    units: { 'pg/ml': 1, 'pmol/l': 1 / 0.7378 },
    synonyms: ['vitamin b12', 'vit b12', 'b12', 'cobalamin'],
  },
  {
    key: 'ferritin',
    display: 'Ferritin',
    loinc: '2276-4',
    canonicalUnit: 'ng/mL',
    units: { 'ng/ml': 1, 'ug/l': 1, 'µg/l': 1 },
    synonyms: ['ferritin', 'serum ferritin'],
  },
  {
    key: 'crp',
    display: 'CRP',
    loinc: '1988-5',
    canonicalUnit: 'mg/L',
    units: { 'mg/l': 1, 'mg/dl': 10 },
    synonyms: ['crp', 'c reactive protein', 'hs crp', 'high sensitivity crp'],
  },
  {
    key: 'sodium',
    display: 'Sodium',
    loinc: '2951-2',
    canonicalUnit: 'mmol/L',
    units: { 'mmol/l': 1, 'meq/l': 1 },
    synonyms: ['sodium', 'na', 'serum sodium', 's sodium'],
  },
  {
    key: 'potassium',
    display: 'Potassium',
    loinc: '2823-3',
    canonicalUnit: 'mmol/L',
    units: { 'mmol/l': 1, 'meq/l': 1 },
    synonyms: ['potassium', 'k', 'serum potassium', 's potassium'],
  },
  {
    key: 'calcium',
    display: 'Calcium',
    loinc: '17861-6',
    canonicalUnit: 'mg/dL',
    units: { 'mg/dl': 1, 'mmol/l': 4.008 },
    synonyms: ['calcium', 'serum calcium', 's calcium', 'total calcium'],
  },
  {
    key: 'inr',
    display: 'INR',
    loinc: '6301-6',
    canonicalUnit: null,
    synonyms: ['inr', 'international normalized ratio', 'international normalised ratio'],
  },
];

/** Strips punctuation, prefixes and qualifiers so lookups are stable. */
export function normalizeTestName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^\p{L}\p{N}%^/]+/gu, ' ')
    .replace(/\b(?:serum|plasma|blood|s|p|test|level|levels|conc|concentration)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How much of the test name a synonym must account for before it is accepted as a
 * partial match. Trailing units ("hba1c %") stay under this; a qualifying phrase that
 * changes what the test is ("potassium hydroxide prep") does not.
 */
const MIN_NAME_COVERAGE = 0.6;

const BY_SYNONYM = new Map<string, Analyte>();
for (const analyte of CATALOGUE) {
  for (const synonym of [...analyte.synonyms, analyte.display]) {
    BY_SYNONYM.set(normalizeTestName(synonym), analyte);
  }
}

export function findAnalyte(testName: string): Analyte | null {
  const normalized = normalizeTestName(testName);
  if (!normalized) return null;

  const exact = BY_SYNONYM.get(normalized);
  if (exact) return exact;

  // "hba1c %" or "creatinine mg/dl" — the analyte with the longest matching synonym
  // wins, so "fasting blood sugar" beats a hypothetical "blood sugar".
  //
  // The match must also cover most of the name. Without that, "Potassium Hydroxide
  // Prep" (a KOH fungal prep) resolves to the potassium electrolyte and its result
  // gets plotted on the same series as a serum potassium.
  let best: { analyte: Analyte; length: number } | null = null;
  for (const [synonym, analyte] of BY_SYNONYM) {
    if (synonym.length < 3) continue;

    const isWordMatch =
      normalized.startsWith(`${synonym} `) ||
      normalized.endsWith(` ${synonym}`) ||
      normalized.includes(` ${synonym} `);
    if (!isWordMatch) continue;

    if (synonym.length / normalized.length < MIN_NAME_COVERAGE) continue;

    if (!best || synonym.length > best.length) {
      best = { analyte, length: synonym.length };
    }
  }

  return best?.analyte ?? null;
}

function normalizeUnit(unit: string): string {
  return unit
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/µ/g, 'u')
    .replace(/^per/, '/');
}

export interface CanonicalLab {
  /** Grouping key, or null when the analyte is not in the catalogue. */
  canonicalTestName: string | null;
  /** Display name; falls back to the verbatim reading. */
  displayName: string;
  loinc: string | null;
  /** Value converted into `canonicalUnit`, when a conversion is known. */
  canonicalValue: number | null;
  canonicalUnit: string | null;
}

/**
 * Resolves one lab row. An unknown analyte keeps its verbatim name and simply does not
 * group — falling back to the raw name is always safe, inventing a mapping is not.
 */
export function canonicalizeLab(
  testName: string,
  numericValue: number | null,
  unit: string | null
): CanonicalLab {
  const analyte = findAnalyte(testName);

  if (!analyte) {
    return {
      canonicalTestName: null,
      displayName: testName,
      loinc: null,
      canonicalValue: null,
      canonicalUnit: null,
    };
  }

  let canonicalValue: number | null = null;
  if (numericValue !== null && analyte.canonicalUnit) {
    if (!unit) {
      // No unit given: assume the canonical one rather than dropping the point.
      canonicalValue = numericValue;
    } else {
      const factor = analyte.units?.[normalizeUnit(unit)];
      if (factor !== undefined) canonicalValue = numericValue * factor;
      else if (normalizeUnit(unit) === normalizeUnit(analyte.canonicalUnit)) {
        canonicalValue = numericValue;
      }
    }
  } else if (numericValue !== null && analyte.canonicalUnit === null) {
    canonicalValue = numericValue; // Unitless, e.g. INR.
  }

  return {
    canonicalTestName: analyte.key,
    displayName: analyte.display,
    loinc: analyte.loinc ?? null,
    canonicalValue,
    canonicalUnit: analyte.canonicalUnit,
  };
}

/** Every analyte the catalogue knows, for a trend picker. */
export function listAnalytes(): Array<{ key: string; display: string; unit: string | null }> {
  return CATALOGUE.map((a) => ({ key: a.key, display: a.display, unit: a.canonicalUnit }));
}
