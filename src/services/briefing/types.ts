import type { MedicationCorrections, MedicationEvaluation, MedicationStatus } from '@/services/medications/types';

export type DoctorSourceType = 'extracted' | 'patient_entered' | 'verified';
export type TreatmentRole = 'prescribing' | 'reviewing' | 'mentioned';
export type TreatmentStatus = 'active' | 'historical' | 'discontinued';

export interface DoctorProfile {
  id: string;
  name: string;
  normalizedName: string;
  specialty: string | null;
  hospital: string | null;
  contactInfo: string | null;
  sourceType: DoctorSourceType;
  isVerified: boolean;
  sourceDocumentId: string | null;
  sourceDocumentTitle: string | null;
  consultationDates: string[];
  prescriptionsCount: number;
  labOrdersCount: number;
  notes: string | null;
}

export interface AttributedMedication {
  id: string;
  name: string;
  genericName: string | null;
  dosage: string | null;
  frequency: string | null;
  duration: string | null;
  route: string | null;
  prescribedDate: string | null;
  status: TreatmentStatus;
  useStatus?: MedicationStatus;
  patientCorrections?: MedicationCorrections;
  prescribingDoctor: {
    name: string;
    specialty: string | null;
    hospital: string | null;
    role: TreatmentRole;
    isIdentified: boolean;
  };
  hospital: string | null;
  sourceDocumentId: string;
  sourceDocumentTitle: string;
  sourceDocumentDate: string | null;
  sourceCitation: string;
  citationIndex?: number;
  pageNumber?: number | null;
  mimeType?: string | null;
  changesNote?: string | null;
}

export interface AttributedLabResult {
  id: string;
  testName: string;
  canonicalTestName: string | null;
  value: string;
  numericValue: number | null;
  unit: string | null;
  referenceRange: string | null;
  isAbnormal: boolean;
  testDate: string;
  orderingDoctor: {
    name: string;
    specialty: string | null;
    isIdentified: boolean;
  };
  performingFacility: string | null;
  sourceDocumentId: string;
  sourceDocumentTitle: string;
  sourceCitation: string;
  citationIndex?: number;
  pageNumber?: number | null;
  mimeType?: string | null;
}

export interface LabTrend {
  testName: string;
  canonicalTestName: string | null;
  unit: string | null;
  referenceRange: string | null;
  latestValue: string;
  latestNumeric: number | null;
  latestDate: string;
  latestIsAbnormal: boolean;
  previousValue: string | null;
  previousNumeric: number | null;
  previousDate: string | null;
  delta: number | null;
  percentageChange: number | null;
  direction: 'improved' | 'worsened' | 'stable' | 'increased' | 'decreased' | 'single_reading';
  clinicalNote: string;
  readingsCount: number;
  sourceDocumentId?: string;
  citationIndex?: number;
}

export interface TreatmentConflict {
  id: string;
  type: 'duplicate_therapy' | 'drug_interaction' | 'dosage_discrepancy' | 'contradictory_instructions' | 'cross_doctor_change';
  severity: 'low' | 'moderate' | 'high';
  title: string;
  description: string;
  involvedDoctors: string[];
  involvedMedications: string[];
  sourceCitations: string[];
  sourceDocumentIds?: string[];
  recommendation: string;
}

export interface DoctorTimelineEvent {
  id: string;
  date: string | null;
  type: 'consultation' | 'prescription' | 'medication_change' | 'lab_order' | 'lab_result' | 'diagnosis' | 'treatment_plan';
  title: string;
  description: string;
  doctorName: string;
  doctorSpecialty: string | null;
  hospital: string | null;
  sourceDocumentId: string;
  sourceDocumentTitle: string;
  pageOrSection?: string | null;
  pageNumber?: number | null;
  mimeType?: string | null;
}

export interface EvidenceCitation {
  index: number;
  documentId: string;
  documentTitle: string;
  fileName?: string | null;
  mimeType?: string | null;
  documentDate: string | null;
  documentType: string;
  pageNumber?: number | null;
  doctorName: string | null;
  doctorSpecialty: string | null;
  hospital: string | null;
  excerpt: string;
  doctorAttributionEvidence: string;
}

export interface DoctorConsultationQuestion {
  id: string;
  category: 'medication_conflict' | 'lab_trend' | 'missing_info' | 'treatment_plan' | 'follow_up';
  question: string;
  rationale: string;
  relevantDoctor: string | null;
  sourceCitations: string[];
  sourceDocumentIds?: string[];
}

export interface BriefingUncertainty {
  category: 'missing_records' | 'unclear_instructions' | 'unconfirmed_discontinuation' | 'outdated_test';
  detail: string;
  impact: string;
}

export interface BriefingCondition {
  id: string;
  condition: string;
  canonicalCondition?: string | null;
  icd10Code?: string | null;
  severity?: string | null;
  assertionStatus: string;
  diagnosedDate?: string | null;
  diagnosingDoctor?: string | null;
  hospital?: string | null;
  sourceDocumentId: string;
  sourceDocumentTitle: string;
  citationIndex?: number;
  pageNumber?: number | null;
  mimeType?: string | null;
}

export interface BriefingAllergy {
  allergen: string;
  allergyType?: string | null;
  severity?: string | null;
  reaction?: string | null;
  sourceDocumentId?: string | null;
  sourceDocumentTitle?: string | null;
  citationIndex?: number;
}

export interface BriefingConsultationPlan {
  id: string;
  date: string | null;
  doctorName: string;
  specialty?: string | null;
  hospital?: string | null;
  planSummary: string;
  followUpInstructions?: string | null;
  sourceDocumentTitle: string;
}

export interface PatientBriefingData {
  generatedAt: string;
  dateRange: {
    from: string | null;
    to: string | null;
    isCoveredAllTime: boolean;
  };
  patient: {
    id: string;
    name: string | null;
    email: string;
    preferredLanguage: string;
  };
  clinicalSummary: string;
  medicationSafety?: MedicationEvaluation | null;
  conditions: BriefingCondition[];
  doctors: DoctorProfile[];
  currentMedications: AttributedMedication[];
  historicalMedications: AttributedMedication[];
  allergies: BriefingAllergy[];
  recentLabResults: AttributedLabResult[];
  labTrends: LabTrend[];
  consultationsAndPlans: BriefingConsultationPlan[];
  treatmentConflicts: TreatmentConflict[];
  uncertainties: BriefingUncertainty[];
  consultationQuestions: DoctorConsultationQuestion[];
  doctorTimeline: DoctorTimelineEvent[];
  citations: EvidenceCitation[];
  documentCount: number;
  isPartial: boolean;
}

export interface BriefingFilterOptions {
  from?: string | null;
  to?: string | null;
  documentIds?: string[];
  doctor?: string | null;
  specialty?: string | null;
  eventType?: string | null;
}
