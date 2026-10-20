/** Shared domain contract. Documented values and patient edits are kept separately. */
export const MEDICATION_STATUSES = [
  'confirmed_current',
  'prescribed_unconfirmed',
  'historical',
  'discontinued',
  'changed',
  'unknown',
] as const;
export type MedicationStatus = (typeof MEDICATION_STATUSES)[number];

export interface MedicationIdentity {
  status: 'verified' | 'unresolved' | 'ambiguous' | 'unavailable';
  normalizedName: string | null;
  rxcui: string | null;
  conceptType: string | null;
  ingredients: Array<{ rxcui: string; name: string }>;
  provider: 'RxNorm' | null;
  version: string | null;
  checkedAt: string | null;
  limitations: string[];
}

export interface MedicationObservation {
  originalName?: string | null;
  brandName?: string | null;
  strength?: string | null;
  unit?: string | null;
  form?: string | null;
  doseAmount?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  prescriber?: string | null;
  sourcePage?: number | null;
  excerpt?: string | null;
  instructions?: string | null;
  confidence?: 'documented' | 'uncertain' | 'unverified';
  status?: MedicationStatus;
  explicitStop?: boolean;
  explicitReplacement?: string | null;
  durationExpected?: boolean;
  normalization?: MedicationIdentity;
}

export interface MedicationCorrections {
  name?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  route?: string | null;
  strength?: string | null;
  doseAmount?: string | null;
  instructions?: string | null;
}

export interface MedicationRecord {
  id: string;
  userId: string;
  documentId: string | null;
  documentTitle: string | null;
  documentType: string | null;
  documentDate: string | null;
  createdAt: string;
  updatedAt?: string;
  name: string;
  genericName: string | null;
  dosage: string | null;
  frequency: string | null;
  duration: string | null;
  route: string | null;
  rxnormId: string | null;
  observation: MedicationObservation;
  patientStatus: MedicationStatus | null;
  corrections: MedicationCorrections;
  sourceActive: boolean;
  sourceKey?: string | null;
}

export interface MedicationAllergy {
  id: string;
  userId: string;
  documentId: string | null;
  documentTitle?: string | null;
  allergen: string;
  reaction: string | null;
  severity: string | null;
  assertionStatus?: string | null;
  /** Only populated after external terminology verification, never from LLM output. */
  verifiedIngredientIds?: string[];
}

export interface MedicationEvidence {
  medicationId: string | null;
  documentId: string | null;
  documentTitle: string | null;
  documentDate: string | null;
  page: number | null;
  excerpt: string | null;
  kind: 'document' | 'patient' | 'allergy_record';
  allergyId?: string;
}

export type FindingCategory =
  | 'allergy_concern'
  | 'drug_interaction'
  | 'exact_duplicate'
  | 'ingredient_duplication'
  | 'therapeutic_duplication'
  | 'conflicting_instructions'
  | 'missing_information'
  | 'uncertain_identity'
  | 'reconciliation_difference';
export type FindingReviewStatus = 'open' | 'needs_verification' | 'reviewed' | 'resolved' | 'dismissed';

export interface KnowledgeSource {
  provider: string;
  version: string | null;
  url: string | null;
  checkedAt: string | null;
}

export interface SafetyFinding {
  id: string;
  userId: string;
  category: FindingCategory;
  medicationIds: string[];
  title: string;
  explanation: string;
  certainty: 'documented' | 'verified' | 'possible' | 'uncertain';
  /** Kept exactly as supplied by a validated provider; no invented severity scale. */
  severity: string | null;
  evidence: MedicationEvidence[];
  knowledgeSource: KnowledgeSource | null;
  detectedAt: string;
  reviewStatus: FindingReviewStatus;
  resolutionNotes: string | null;
  current: boolean;
}

export type MedicationEventType =
  | 'first_documented'
  | 'new_prescription'
  | 'dose_change'
  | 'strength_change'
  | 'frequency_change'
  | 'route_change'
  | 'duration_change'
  | 'form_change'
  | 'explicit_discontinuation'
  | 'replacement'
  | 'patient_confirmation'
  | 'patient_correction'
  | 'reconciliation_conflict'
  | 'safety_finding';

export interface MedicationTimelineEvent {
  id: string;
  userId: string;
  type: MedicationEventType;
  medicationIds: string[];
  /** Source date text is preserved; absent/approximate dates are never replaced by upload dates. */
  date: string | null;
  title: string;
  description: string;
  confirmation: 'documented' | 'patient_reported' | 'needs_verification';
  evidence: MedicationEvidence[];
}

export interface ReconciliationDifference {
  id: string;
  medicationIds: [string, string];
  field: 'dosage' | 'strength' | 'frequency' | 'duration' | 'route' | 'form' | 'instructions' | 'identity';
  before: string | null;
  after: string | null;
  explanation: string;
  evidence: MedicationEvidence[];
}

export interface PrescriptionComparison {
  documentIds: [string, string];
  differences: ReconciliationDifference[];
  onlyInFirst: string[];
  onlyInSecond: string[];
  limitations: string[];
}

export interface InteractionCoverage {
  status: 'available' | 'partial' | 'unavailable' | 'unsupported' | 'failed';
  provider: string;
  version: string | null;
  checkedAt: string;
  checkedPairs: number;
  totalPairs: number;
  limitations: string[];
}

export interface MedicationEvaluation {
  findings: SafetyFinding[];
  timeline: MedicationTimelineEvent[];
  interactionCoverage: InteractionCoverage;
  limitations: string[];
  evaluatedAt: string;
}

export interface MedicationSnapshot {
  medications: MedicationRecord[];
  allergies: MedicationAllergy[];
  findings: SafetyFinding[];
  limitations?: string[];
}
