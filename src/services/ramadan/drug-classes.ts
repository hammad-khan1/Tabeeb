/**
 * Glucose-lowering drugs by the class the IDF-DAR treatment item scores, with the brand
 * names they are sold under in Pakistan.
 *
 * The existing drug normalizer corrects spelling against RxNorm, which does not know
 * Pakistani brands (Getryl, Neodipar) and does not say what class a drug is in. This
 * table does both, for the one question the risk score asks. It is curated and small on
 * purpose: a name it does not know is reported as unknown and asked about — never
 * counted as "other therapy", which scores zero.
 *
 * Combination products are listed under every class they contain, so Glucovance
 * (glibenclamide + metformin) counts as glibenclamide.
 *
 * Brand list to be reviewed by a pharmacist before release.
 */

export type DrugClass =
  /** Scored: glibenclamide. */
  | 'glibenclamide'
  /** Scored: gliclazide / gliclazide MR, glimepiride, repaglinide. */
  | 'short_acting_su'
  /** Scored: basal insulin. */
  | 'basal_insulin'
  /** Premixed insulin: the score depends on once vs several daily, so it is asked. */
  | 'mixed_insulin'
  /** Rapid or short-acting insulin: part of a basal-bolus regimen, so it is asked. */
  | 'prandial_insulin'
  /** A glucose-lowering drug that is neither a sulfonylurea nor insulin. */
  | 'other_glucose_lowering';

interface DrugEntry {
  generic: string;
  classes: DrugClass[];
  /** Generic and brand names, lowercase, matched as whole words. */
  names: string[];
}

export const DIABETES_DRUGS: readonly DrugEntry[] = [
  // Sulfonylureas and glinides
  { generic: 'glibenclamide', classes: ['glibenclamide'], names: ['glibenclamide', 'glyburide', 'daonil', 'euglucon'] },
  {
    generic: 'glibenclamide + metformin',
    classes: ['glibenclamide', 'other_glucose_lowering'],
    names: ['glucovance'],
  },
  { generic: 'gliclazide', classes: ['short_acting_su'], names: ['gliclazide', 'diamicron'] },
  { generic: 'glimepiride', classes: ['short_acting_su'], names: ['glimepiride', 'amaryl', 'getryl'] },
  {
    generic: 'glimepiride + metformin',
    classes: ['short_acting_su', 'other_glucose_lowering'],
    names: ['amaryl m', 'getryl m'],
  },
  { generic: 'repaglinide', classes: ['short_acting_su'], names: ['repaglinide', 'novonorm', 'prandin'] },

  // Basal insulin
  { generic: 'insulin glargine', classes: ['basal_insulin'], names: ['glargine', 'lantus', 'toujeo', 'basaglar'] },
  { generic: 'insulin detemir', classes: ['basal_insulin'], names: ['detemir', 'levemir'] },
  { generic: 'insulin degludec', classes: ['basal_insulin'], names: ['degludec', 'tresiba'] },
  // NPH is intermediate-acting; whether the table counts it as basal is to be checked.
  { generic: 'insulin NPH', classes: ['basal_insulin'], names: ['nph', 'isophane', 'insulatard', 'humulin n'] },

  // Premixed insulin
  {
    generic: 'premixed insulin',
    classes: ['mixed_insulin'],
    // "biphasic" before the bare analogue names below, so biphasic aspart is premixed.
    names: ['mixtard', 'novomix', 'humulin 70/30', 'humalog mix', 'biphasic', '70/30', '30/70'],
  },

  // Prandial insulin
  {
    generic: 'rapid or short-acting insulin',
    classes: ['prandial_insulin'],
    names: ['actrapid', 'novorapid', 'humalog', 'apidra', 'humulin r', 'aspart', 'lispro', 'glulisine', 'regular insulin'],
  },

  // Neither sulfonylurea nor insulin
  { generic: 'metformin', classes: ['other_glucose_lowering'], names: ['metformin', 'glucophage', 'neodipar'] },
  { generic: 'sitagliptin', classes: ['other_glucose_lowering'], names: ['sitagliptin', 'januvia', 'janumet'] },
  { generic: 'vildagliptin', classes: ['other_glucose_lowering'], names: ['vildagliptin', 'galvus', 'galvus met'] },
  { generic: 'linagliptin', classes: ['other_glucose_lowering'], names: ['linagliptin', 'trajenta'] },
  { generic: 'empagliflozin', classes: ['other_glucose_lowering'], names: ['empagliflozin', 'jardiance', 'synjardy'] },
  { generic: 'dapagliflozin', classes: ['other_glucose_lowering'], names: ['dapagliflozin', 'forxiga', 'xigduo'] },
  { generic: 'pioglitazone', classes: ['other_glucose_lowering'], names: ['pioglitazone', 'actos'] },
];

export interface DrugMatch {
  generic: string;
  classes: DrugClass[];
  /** The name in the table that matched. */
  matchedName: string;
}

function normalizeDrugText(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9/+]+/g, ' ').trim()} `;
}

/**
 * Every table entry whose name appears as a whole word. Longer names win, so
 * "Amaryl M" is the combination and not also plain Amaryl.
 */
export function classifyDrug(name: string): DrugMatch[] {
  const text = normalizeDrugText(name);
  const candidates = DIABETES_DRUGS.flatMap((entry) =>
    entry.names.map((drugName) => ({ entry, drugName }))
  ).sort((a, b) => b.drugName.length - a.drugName.length);

  const matches: DrugMatch[] = [];
  let remaining = text;
  for (const { entry, drugName } of candidates) {
    const needle = normalizeDrugText(drugName);
    if (!remaining.includes(needle)) continue;
    remaining = remaining.replace(needle, ' ');
    if (!matches.some((match) => match.generic === entry.generic)) {
      matches.push({ generic: entry.generic, classes: entry.classes, matchedName: drugName });
    }
  }
  return matches;
}
