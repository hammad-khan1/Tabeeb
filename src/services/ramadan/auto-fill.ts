/**
 * Fills what it can of the IDF-DAR risk score from the patient's own records, and says
 * where each value came from.
 *
 * It only fills an item when the record answers it outright. Everything else is asked,
 * with whatever the record does say shown as a hint. In particular, nothing in the
 * record is read as a "no": a record with no heart disease in it is a record without
 * that page, not a patient without that disease, so the zero-point answers always come
 * from the patient.
 *
 * Only diagnoses the source document attributes to the patient as current or past are
 * used. Suspected ones are shown as hints and never fill an item.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  diagnoses,
  labResults,
  medications,
  type RamadanProvenance,
} from '../../../drizzle/schema';
import {
  EGFR_OPTIONS,
  HBA1C_OPTIONS,
  TREATMENT_COMBINATION_RULE,
  RISK_ITEMS,
  type RiskItemId,
} from './constants';
import { classifyDrug, type DrugClass } from './drug-classes';
import { fastingTimes } from './prayer-times';

// ── Record snapshot ─────────────────────────────────────────────────────────

export interface LabRow {
  id: string;
  documentId: string;
  canonicalTestName: string | null;
  canonicalValue: number | null;
  canonicalUnit: string | null;
  value: string;
  unit: string | null;
  testDate: Date;
}

export interface MedicationRow {
  id: string;
  documentId: string;
  name: string;
  genericName: string | null;
  frequency: string | null;
  prescribedDate: Date | null;
}

export interface DiagnosisRow {
  id: string;
  documentId: string;
  condition: string;
  canonicalCondition: string | null;
  assertionStatus: string | null;
  diagnosedDate: Date | null;
}

export interface FastingWindow {
  planId: string;
  city: string;
  /** The longest day of the planned month, in minutes from Fajr to Maghrib. */
  longestFastMinutes: number;
  longestFastDate: string;
}

export interface RecordSnapshot {
  labs: LabRow[];
  /** Active medications only. */
  medications: MedicationRow[];
  diagnoses: DiagnosisRow[];
  fasting: FastingWindow | null;
}

// ── Result ──────────────────────────────────────────────────────────────────

export interface FilledInput {
  item: RiskItemId;
  option: string;
  value: string;
  provenance: RamadanProvenance;
}

export type PendingReason =
  /** Never in a medical record: hypoglycaemia history, labour, last Ramzan, and so on. */
  | 'always_asked'
  /** The record has nothing on it. */
  | 'not_in_record'
  /** The record has a value, but too old to describe the patient now. */
  | 'record_too_old'
  /** The record says it exists but not the detail the table scores (stable or unstable). */
  | 'needs_detail'
  /** Diagnoses in the record disagree. */
  | 'conflicting'
  /** Active medicines include names this module cannot classify. */
  | 'unrecognised_medicines'
  /** Several scored treatments; how to combine them is not yet verified. */
  | 'combination_unverified';

export interface PendingInput {
  item: RiskItemId;
  reason: PendingReason;
  /** What the record does say, for the patient to see while answering. */
  hints: RamadanProvenance[];
  /** An option the record points to, for the patient to confirm. Never applied unasked. */
  suggestedOption?: string;
}

export interface RiskInputs {
  filled: FilledInput[];
  pending: PendingInput[];
}

// ── Rules ───────────────────────────────────────────────────────────────────

/**
 * How old a lab value may be and still describe the patient now. An app choice, not a
 * guideline value: HbA1c reflects roughly three months, and an older one is shown as a
 * hint rather than scored.
 */
const HBA1C_MAX_AGE_DAYS = 183;
const EGFR_MAX_AGE_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

const PATIENT_OWN = new Set(['present', 'historical']);

const DIABETES = new Set(['Type 2 diabetes mellitus', 'Type 1 diabetes mellitus', 'Gestational diabetes']);
const MACROVASCULAR = new Set([
  'Coronary artery disease',
  'Acute myocardial infarction',
  'Angina pectoris',
  'Stroke',
]);

/**
 * The type is read from the document's own words, not from the linked concept: the
 * linker files a bare "diabetes" or "DM" under type 2, which is a fair default for a
 * history page and not good enough for a score where the types differ.
 */
const TYPE_1_WORDS = /\b(?:type\s*(?:1|i|one)\b|t1dm\b|iddm\b|juvenile)/i;
const TYPE_2_WORDS = /\b(?:type\s*(?:2|ii|two)\b|t2dm\b|niddm\b|dm\s*(?:2|ii)\b)/i;
const PREGNANCY_WORDS = /pregnan|gravid|\bhamal\b|حمل/i;

const ALWAYS_ASKED: readonly RiskItemId[] = [
  'hypoglycaemia',
  'self_monitoring',
  'acute_complications',
  'frailty_cognition',
  'physical_labour',
  'previous_ramadan',
];

function isoDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function fromLab(row: LabRow): RamadanProvenance {
  return {
    table: 'lab_results',
    rowId: row.id,
    documentId: row.documentId,
    value: `${row.value}${row.unit ? ` ${row.unit}` : ''}`,
    date: isoDate(row.testDate),
  };
}

function fromMedication(row: MedicationRow): RamadanProvenance {
  return {
    table: 'medications',
    rowId: row.id,
    documentId: row.documentId,
    value: [row.name, row.frequency].filter(Boolean).join(', '),
    date: isoDate(row.prescribedDate),
  };
}

function fromDiagnosis(row: DiagnosisRow): RamadanProvenance {
  return {
    table: 'diagnoses',
    rowId: row.id,
    documentId: row.documentId,
    value: row.condition,
    date: isoDate(row.diagnosedDate),
  };
}

function ageInDays(date: Date, now: Date): number {
  return (now.getTime() - date.getTime()) / DAY_MS;
}

function latestLab(labs: LabRow[], key: string): LabRow | null {
  return (
    labs
      .filter((lab) => lab.canonicalTestName === key)
      .sort((a, b) => b.testDate.getTime() - a.testDate.getTime())[0] ?? null
  );
}

// ── Items ───────────────────────────────────────────────────────────────────

type Outcome = FilledInput | PendingInput;

function diabetesType(diags: DiagnosisRow[]): Outcome {
  const diabetic = diags.filter((d) => DIABETES.has(d.canonicalCondition ?? ''));
  const own = diabetic.filter((d) => PATIENT_OWN.has(d.assertionStatus ?? 'present'));
  const hints = diabetic.map(fromDiagnosis);

  const type1 = own.filter((d) => TYPE_1_WORDS.test(d.condition));
  const type2 = own.filter((d) => TYPE_2_WORDS.test(d.condition));

  if (type1.length > 0 && type2.length > 0) return { item: 'diabetes_type', reason: 'conflicting', hints };

  const explicit = type1[0] ?? type2[0];
  if (!explicit) {
    return { item: 'diabetes_type', reason: hints.length > 0 ? 'needs_detail' : 'not_in_record', hints };
  }

  return {
    item: 'diabetes_type',
    option: type1.length > 0 ? 'type1' : 'type2',
    value: explicit.condition,
    provenance: fromDiagnosis(explicit),
  };
}

function diabetesDuration(diags: DiagnosisRow[], now: Date): Outcome {
  const dated = diags
    .filter((d) => DIABETES.has(d.canonicalCondition ?? '') && PATIENT_OWN.has(d.assertionStatus ?? 'present'))
    .filter((d): d is DiagnosisRow & { diagnosedDate: Date } => d.diagnosedDate !== null)
    .sort((a, b) => a.diagnosedDate.getTime() - b.diagnosedDate.getTime());

  const earliest = dated[0];
  if (!earliest) return { item: 'diabetes_duration', reason: 'not_in_record', hints: [] };

  // The earliest record is a lower bound on how long they have had it: it can prove
  // ten years, never fewer.
  const tenYearsAgo = new Date(now);
  tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
  if (earliest.diagnosedDate <= tenYearsAgo) {
    return {
      item: 'diabetes_duration',
      option: 'ten_or_more',
      value: `Diagnosed by ${isoDate(earliest.diagnosedDate)}`,
      provenance: fromDiagnosis(earliest),
    };
  }
  return { item: 'diabetes_duration', reason: 'needs_detail', hints: [fromDiagnosis(earliest)] };
}

function hba1c(labs: LabRow[], now: Date): Outcome {
  const latest = latestLab(labs, 'hba1c');
  if (!latest) return { item: 'hba1c', reason: 'not_in_record', hints: [] };

  const percent = latest.canonicalUnit === '%' ? latest.canonicalValue : null;
  if (percent === null) return { item: 'hba1c', reason: 'needs_detail', hints: [fromLab(latest)] };
  if (ageInDays(latest.testDate, now) > HBA1C_MAX_AGE_DAYS) {
    return { item: 'hba1c', reason: 'record_too_old', hints: [fromLab(latest)] };
  }

  const option =
    percent > HBA1C_OPTIONS.highAbove ? 'over_9' : percent >= HBA1C_OPTIONS.midFrom ? '7_5_to_9' : 'under_7_5';
  return { item: 'hba1c', option, value: `HbA1c ${percent}%`, provenance: fromLab(latest) };
}

function renal(labs: LabRow[], diags: DiagnosisRow[], now: Date): Outcome {
  const egfr = latestLab(labs, 'egfr');
  const creatinine = latestLab(labs, 'creatinine');
  const ckd = diags.filter((d) => d.canonicalCondition === 'Chronic kidney disease').map(fromDiagnosis);

  // eGFR needs age and sex to compute from creatinine, and the record has neither, so
  // creatinine is only ever a hint.
  const hints = [creatinine ? fromLab(creatinine) : null, ...ckd].filter(
    (hint): hint is RamadanProvenance => hint !== null
  );

  if (!egfr || egfr.canonicalValue === null) {
    return { item: 'renal', reason: hints.length > 0 ? 'needs_detail' : 'not_in_record', hints };
  }
  if (ageInDays(egfr.testDate, now) > EGFR_MAX_AGE_DAYS) {
    return { item: 'renal', reason: 'record_too_old', hints: [fromLab(egfr), ...hints] };
  }

  const value = egfr.canonicalValue;
  const option =
    value < EGFR_OPTIONS.severeBelow
      ? 'egfr_under_30'
      : value < EGFR_OPTIONS.moderateBelow
        ? 'egfr_30_45'
        : value < EGFR_OPTIONS.mildBelow
          ? 'egfr_45_60'
          : 'egfr_over_60';
  return { item: 'renal', option, value: `eGFR ${value}`, provenance: fromLab(egfr) };
}

function macrovascular(diags: DiagnosisRow[]): Outcome {
  const hints = diags.filter((d) => MACROVASCULAR.has(d.canonicalCondition ?? '')).map(fromDiagnosis);
  // Whether it is stable is a clinical judgement the record does not state.
  return { item: 'macrovascular', reason: hints.length > 0 ? 'needs_detail' : 'not_in_record', hints };
}

function pregnancy(diags: DiagnosisRow[]): Outcome {
  // Asked every time: a pregnancy in the record may be long over.
  const hints = diags
    .filter((d) => PREGNANCY_WORDS.test(d.condition) || d.canonicalCondition === 'Gestational diabetes')
    .map(fromDiagnosis);
  return { item: 'pregnancy', reason: 'always_asked', hints };
}

const SCORED_TREATMENTS: ReadonlyArray<{ drugClass: DrugClass; option: string }> = [
  // Order matters only for the `highest` rule, and follows the confirmed points.
  { drugClass: 'basal_insulin', option: 'basal_insulin' },
  { drugClass: 'glibenclamide', option: 'glibenclamide' },
  { drugClass: 'short_acting_su', option: 'short_acting_su' },
];

function treatment(meds: MedicationRow[]): Outcome {
  const classified = meds.map((med) => ({ med, matches: classifyDrug(med.name) }));
  const unrecognised = classified.filter((entry) => entry.matches.length === 0);
  const classes = new Set(classified.flatMap((entry) => entry.matches.flatMap((match) => match.classes)));
  const hints = meds.map(fromMedication);

  const scored = SCORED_TREATMENTS.filter(({ drugClass }) => classes.has(drugClass));
  const withClass = (drugClass: DrugClass) =>
    classified.find((entry) => entry.matches.some((match) => match.classes.includes(drugClass)))!.med;

  let suggestion: { option: string; med: MedicationRow } | null = null;
  let blocked: PendingReason | null = null;

  if (classes.has('mixed_insulin') || classes.has('prandial_insulin')) {
    // Once-daily mixed, multiple mixed and basal-bolus score differently, and which
    // one this is depends on how often it is injected.
    blocked = 'needs_detail';
  } else if (scored.length > 1) {
    if (TREATMENT_COMBINATION_RULE === 'highest') {
      suggestion = { option: scored[0].option, med: withClass(scored[0].drugClass) };
    } else {
      blocked = 'combination_unverified';
    }
  } else if (scored.length === 1) {
    suggestion = { option: scored[0].option, med: withClass(scored[0].drugClass) };
  } else if (classes.has('other_glucose_lowering')) {
    suggestion = { option: 'other', med: withClass('other_glucose_lowering') };
  } else {
    blocked = unrecognised.length > 0 ? 'unrecognised_medicines' : 'not_in_record';
  }

  if (blocked) return { item: 'treatment', reason: blocked, hints };

  // An unrecognised name could be a sulfonylurea or an insulin under a brand this
  // module does not know, so the record's answer becomes a suggestion to confirm.
  if (unrecognised.length > 0) {
    return { item: 'treatment', reason: 'unrecognised_medicines', hints, suggestedOption: suggestion!.option };
  }

  return {
    item: 'treatment',
    option: suggestion!.option,
    value: suggestion!.med.name,
    provenance: fromMedication(suggestion!.med),
  };
}

function fastingHours(fasting: FastingWindow | null): Outcome {
  if (!fasting) return { item: 'fasting_hours', reason: 'not_in_record', hints: [] };

  const hours = Math.floor(fasting.longestFastMinutes / 60);
  const minutes = fasting.longestFastMinutes % 60;
  const value = `Longest fast ${hours}h ${minutes}m (${fasting.city}, ${fasting.longestFastDate})`;
  return {
    item: 'fasting_hours',
    option: fasting.longestFastMinutes >= 16 * 60 ? 'sixteen_or_more' : 'under_sixteen',
    value,
    provenance: {
      table: 'prayer_times',
      rowId: fasting.planId,
      documentId: null,
      value,
      date: fasting.longestFastDate,
    },
  };
}

/** Pure: everything the score needs from a snapshot of the record. */
export function deriveRiskInputs(snapshot: RecordSnapshot, now: Date = new Date()): RiskInputs {
  const outcomes: Outcome[] = [
    diabetesType(snapshot.diagnoses),
    diabetesDuration(snapshot.diagnoses, now),
    hba1c(snapshot.labs, now),
    treatment(snapshot.medications),
    renal(snapshot.labs, snapshot.diagnoses, now),
    macrovascular(snapshot.diagnoses),
    pregnancy(snapshot.diagnoses),
    fastingHours(snapshot.fasting),
    ...ALWAYS_ASKED.map((item): PendingInput => ({ item, reason: 'always_asked', hints: [] })),
  ];

  // Returned in the table's order, so the wizard asks in the order a clinician reads.
  const order = new Map(RISK_ITEMS.map((item, index) => [item.id, index]));
  outcomes.sort((a, b) => (order.get(a.item) ?? 0) - (order.get(b.item) ?? 0));

  return {
    filled: outcomes.filter((outcome): outcome is FilledInput => 'option' in outcome),
    pending: outcomes.filter((outcome): outcome is PendingInput => 'reason' in outcome),
  };
}

// ── Loading ─────────────────────────────────────────────────────────────────

export interface PlanForFasting {
  id: string;
  city: string | null;
  latitude?: number | null;
  longitude?: number | null;
  ramadanStart: string;
  ramadanEnd: string;
}

/** The longest fast of the planned month, from the plan's location. */
export function longestFast(plan: PlanForFasting): FastingWindow | null {
  if (plan.latitude == null || plan.longitude == null) return null;
  const location = { latitude: plan.latitude, longitude: plan.longitude };

  let longest: FastingWindow | null = null;
  const end = new Date(`${plan.ramadanEnd}T00:00:00Z`);
  for (let day = new Date(`${plan.ramadanStart}T00:00:00Z`); day <= end; day = new Date(day.getTime() + DAY_MS)) {
    const date = day.toISOString().slice(0, 10);
    const { fastingMinutes } = fastingTimes(date, location);
    if (!longest || fastingMinutes > longest.longestFastMinutes) {
      longest = {
        planId: plan.id,
        city: plan.city ?? `${location.latitude.toFixed(2)}, ${location.longitude.toFixed(2)}`,
        longestFastMinutes: fastingMinutes,
        longestFastDate: date,
      };
    }
  }
  return longest;
}

/** Reads the caller's own record and derives the inputs. Every query is scoped by user. */
export async function collectRiskInputs(
  userId: string,
  plan: PlanForFasting | null,
  now: Date = new Date()
): Promise<RiskInputs> {
  const db = getDb();

  const [labs, meds, diags] = await Promise.all([
    db
      .select({
        id: labResults.id,
        documentId: labResults.documentId,
        canonicalTestName: labResults.canonicalTestName,
        canonicalValue: labResults.canonicalValue,
        canonicalUnit: labResults.canonicalUnit,
        value: labResults.value,
        unit: labResults.unit,
        testDate: labResults.testDate,
      })
      .from(labResults)
      .where(
        and(
          eq(labResults.userId, userId),
          inArray(labResults.canonicalTestName, ['hba1c', 'egfr', 'creatinine'])
        )
      )
      .orderBy(desc(labResults.testDate))
      .limit(60),
    db
      .select({
        id: medications.id,
        documentId: medications.documentId,
        name: medications.name,
        genericName: medications.genericName,
        frequency: medications.frequency,
        prescribedDate: medications.prescribedDate,
      })
      .from(medications)
      .where(and(eq(medications.userId, userId), eq(medications.isActive, true)))
      .orderBy(desc(medications.prescribedDate))
      .limit(60),
    db
      .select({
        id: diagnoses.id,
        documentId: diagnoses.documentId,
        condition: diagnoses.condition,
        canonicalCondition: diagnoses.canonicalCondition,
        assertionStatus: diagnoses.assertionStatus,
        diagnosedDate: diagnoses.diagnosedDate,
      })
      .from(diagnoses)
      .where(eq(diagnoses.userId, userId))
      .orderBy(desc(diagnoses.diagnosedDate))
      .limit(200),
  ]);

  return deriveRiskInputs(
    { labs, medications: meds, diagnoses: diags, fasting: plan ? longestFast(plan) : null },
    now
  );
}

/** True when the record carries a diabetes diagnosis the document attributes to the patient. */
export async function hasDiabetes(userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ assertionStatus: diagnoses.assertionStatus })
    .from(diagnoses)
    .where(and(eq(diagnoses.userId, userId), inArray(diagnoses.canonicalCondition, [...DIABETES])))
    .limit(20);
  return rows.some((row) => PATIENT_OWN.has(row.assertionStatus ?? 'present'));
}
