/**
 * Every clinical number Ramzan Mode uses, in one place.
 *
 * Source: Hassanein M, Afandi B, Yakoob Ahmedani M et al. Diabetes and Ramadan:
 * Practical guidelines 2021. Diabetes Res Clin Pract 2022;185:109185 (IDF-DAR 2021),
 * and its summary in the Journal of Diabetes Nursing ("Fasting and feasting safely
 * with type 2 diabetes in Ramadan").
 *
 * Nothing here is model output, and nothing here is guessed. A value that has not been
 * checked against the guideline is `null` with a `TODO(verify)` comment, and
 * constants.test.ts fails until a person fills it in from the guideline's table. The
 * scorer refuses to produce a band from an unverified value — see risk-score.ts.
 *
 * Option labels for the TODO(verify) items were written from memory of the 2021 risk
 * table and must be checked against it along with the points.
 */

// ── Risk bands ──────────────────────────────────────────────────────────────

/** IDF-DAR 2021 risk categories: low 0–3, moderate 3.5–6, high > 6. */
export const RISK_BANDS = {
  /** Highest total that is still low risk. */
  lowMax: 3,
  /** Highest total that is still moderate risk. */
  moderateMax: 6,
} as const;

/** Every item scores in multiples of this, so every total does too. */
export const SCORE_STEP = 0.5;

export type RiskBand = 'low' | 'moderate' | 'high';

// ── Risk items ──────────────────────────────────────────────────────────────

export type RiskItemId =
  | 'diabetes_type'
  | 'diabetes_duration'
  | 'hypoglycaemia'
  | 'hba1c'
  | 'treatment'
  | 'self_monitoring'
  | 'acute_complications'
  | 'macrovascular'
  | 'renal'
  | 'pregnancy'
  | 'frailty_cognition'
  | 'physical_labour'
  | 'previous_ramadan'
  | 'fasting_hours';

export interface RiskOption {
  id: string;
  label: string;
  /** null until checked against the guideline table. */
  points: number | null;
}

export interface RiskItem {
  id: RiskItemId;
  label: string;
  options: readonly RiskOption[];
}

export const RISK_ITEMS: readonly RiskItem[] = [
  {
    id: 'diabetes_type',
    label: 'Type of diabetes',
    options: [
      { id: 'type1', label: 'Type 1 diabetes', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'type2', label: 'Type 2 diabetes', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
    ],
  },
  {
    id: 'diabetes_duration',
    label: 'Duration of diabetes',
    options: [
      { id: 'ten_or_more', label: '10 years or more', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'under_ten', label: 'Less than 10 years', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
    ],
  },
  {
    id: 'hypoglycaemia',
    label: 'Presence of hypoglycaemia',
    options: [
      { id: 'unawareness', label: 'Hypoglycaemia unawareness', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'recent_severe', label: 'Recent severe hypoglycaemia', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'multiple_weekly', label: 'Multiple weekly hypoglycaemia', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'under_once_weekly', label: 'Hypoglycaemia less than once a week', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'none', label: 'No hypoglycaemia', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
    ],
  },
  {
    id: 'hba1c',
    label: 'Level of glycaemic control (HbA1c)',
    options: [
      { id: 'over_9', label: 'HbA1c above 9% (75 mmol/mol)', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: '7_5_to_9', label: 'HbA1c 7.5–9% (58–75 mmol/mol)', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'under_7_5', label: 'HbA1c below 7.5% (58 mmol/mol)', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
    ],
  },
  {
    id: 'treatment',
    label: 'Type of treatment',
    options: [
      { id: 'mixed_insulin_multiple', label: 'Multiple daily mixed insulin injections', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'basal_bolus_or_pump', label: 'Basal-bolus insulin or insulin pump', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'mixed_insulin_once', label: 'Once-daily mixed insulin', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      // Confirmed: Journal of Diabetes Nursing summary of IDF-DAR 2021.
      { id: 'basal_insulin', label: 'Basal insulin', points: 1.5 },
      { id: 'glibenclamide', label: 'Glibenclamide', points: 1 },
      { id: 'short_acting_su', label: 'Gliclazide / gliclazide MR, glimepiride or repaglinide', points: 0.5 },
      { id: 'other', label: 'Other therapy, not including a sulfonylurea or insulin', points: 0 },
    ],
  },
  {
    id: 'self_monitoring',
    label: 'Self-monitoring of blood glucose (SMBG)',
    options: [
      { id: 'indicated_not_done', label: 'Indicated but not conducted', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'indicated_suboptimal', label: 'Indicated but conducted sub-optimally', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'as_indicated', label: 'Conducted as indicated', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
    ],
  },
  {
    id: 'acute_complications',
    label: 'Acute complications (DKA or HHS)',
    options: [
      { id: 'last_3_months', label: 'DKA or HHS in the last 3 months', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'last_6_months', label: 'DKA or HHS in the last 6 months', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'last_12_months', label: 'DKA or HHS in the last 12 months', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'none', label: 'No DKA or HHS', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
    ],
  },
  {
    id: 'macrovascular',
    label: 'Macrovascular complications',
    options: [
      { id: 'unstable', label: 'Unstable macrovascular disease', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'stable', label: 'Stable macrovascular disease', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'none', label: 'No macrovascular disease', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
    ],
  },
  {
    id: 'renal',
    label: 'Renal complications (eGFR, mL/min/1.73m²)',
    options: [
      { id: 'egfr_under_30', label: 'eGFR below 30', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'egfr_30_45', label: 'eGFR 30–45', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'egfr_45_60', label: 'eGFR 45–60', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'egfr_over_60', label: 'eGFR above 60', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
    ],
  },
  {
    id: 'pregnancy',
    label: 'Pregnancy',
    options: [
      { id: 'not_within_targets', label: 'Pregnant, not within targets', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'within_targets', label: 'Pregnant, within targets', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'not_pregnant', label: 'Not pregnant', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
    ],
  },
  {
    id: 'frailty_cognition',
    label: 'Frailty and cognitive function',
    options: [
      { id: 'impaired_or_frail', label: 'Impaired cognitive function or frail', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'over_70_no_support', label: 'Over 70 with no home support', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'none', label: 'No frailty or loss of cognitive function', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
    ],
  },
  {
    id: 'physical_labour',
    label: 'Physical labour',
    options: [
      { id: 'high', label: 'Highly intense physical labour', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'moderate', label: 'Moderately intense physical labour', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'none', label: 'No physical labour', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
    ],
  },
  {
    id: 'previous_ramadan',
    label: 'Previous Ramadan experience',
    options: [
      { id: 'negative', label: 'Overall negative experience', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'not_negative', label: 'No negative or positive experience', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
    ],
  },
  {
    // Not in the build prompt's list, but in the 2021 table as recalled. Delete this
    // item if the guideline does not have it.
    id: 'fasting_hours',
    label: 'Fasting hours (location)',
    options: [
      { id: 'sixteen_or_more', label: '16 hours or more', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
      { id: 'under_sixteen', label: 'Less than 16 hours', points: null }, // TODO(verify): IDF-DAR 2021 risk score table
    ],
  },
];

/**
 * How a patient on several glucose-lowering treatments is scored. The confirmed points
 * are per treatment; whether the item takes the highest-scoring one or something else
 * is not confirmed, so the scorer will not combine treatments until this is set.
 */
export const TREATMENT_COMBINATION_RULE: 'highest' | null = null; // TODO(verify): IDF-DAR 2021 risk score table, multiple treatments

/**
 * Which option a recorded HbA1c or eGFR falls in. The table gives ranges ("7.5–9%",
 * "eGFR 30–45") without saying which side owns a value exactly on the edge, so the
 * edges are not trusted until checked: `verified: false` keeps the verify test failing.
 */
export const HBA1C_OPTIONS = {
  verified: false, // TODO(verify): IDF-DAR 2021 risk score table, HbA1c edge ownership
  /** Percent. Above this is over_9; at or above `midFrom` is 7_5_to_9; below is under_7_5. */
  highAbove: 9,
  midFrom: 7.5,
} as const;

export const EGFR_OPTIONS = {
  verified: false, // TODO(verify): IDF-DAR 2021 risk score table, eGFR edge ownership
  /** mL/min/1.73m². Below `severeBelow` is egfr_under_30, and so on upward. */
  severeBelow: 30,
  moderateBelow: 45,
  mildBelow: 60,
} as const;

// ── Break-the-fast thresholds ───────────────────────────────────────────────

/**
 * IDF-DAR 2021, as summarised in the Journal of Diabetes Nursing: break the fast below
 * 70 mg/dL (3.9 mmol/L) or above 300 mg/dL (16.6 mmol/L), or with symptoms of
 * hypoglycaemia or acute illness, whatever the reading.
 */
export const BREAK_FAST_BELOW_MG_DL = 70;
export const BREAK_FAST_ABOVE_MG_DL = 300;

/** Glucose molar mass 180.16 g/mol: 1 mmol/L = 18.016 mg/dL. */
export const MG_DL_PER_MMOL_L = 18.016;

// ── Glucose checks during the fast ──────────────────────────────────────────

/**
 * When to prompt for a glucose check, from the IDF-DAR monitoring advice as the build
 * spec states it: mid-day, about 2 hours before Iftar, and 2 hours after Iftar.
 * Mid-day is taken as halfway between Fajr and Maghrib.
 */
export const PRE_IFTAR_CHECK_MINUTES = 120;
export const POST_IFTAR_CHECK_MINUTES = 120;
