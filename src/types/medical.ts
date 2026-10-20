export interface Medication {
  name: string;
  genericName?: string;
  brandName?: string;
  dosage?: string;
  strength?: string;
  unit?: string;
  form?: string;
  doseAmount?: string;
  frequency?: string;
  duration?: string;
  route?: string;
  rxnormId?: string;
  isActive?: boolean;
  prescribedDate?: string;
  startDate?: string;
  endDate?: string;
  prescriber?: string;
  sourcePage?: number;
  excerpt?: string;
  instructions?: string;
  uncertain?: boolean;
  status?: 'prescribed_unconfirmed' | 'historical' | 'discontinued' | 'changed' | 'unknown';
  explicitStop?: boolean;
  explicitReplacement?: string;
  durationExpected?: boolean;
}

export interface Diagnosis {
  condition: string;
  icd10Code?: string;
  severity?: string;
  notes?: string;
  diagnosedDate?: string;
}

export interface LabResult {
  testName: string;
  value: string;
  numericValue?: number;
  unit?: string;
  referenceRange?: string;
  isAbnormal?: boolean;
  testDate: string;
}

export interface Allergy {
  allergen: string;
  allergyType?: string;
  severity?: string;
  reaction?: string;
}

export interface StructuredExtraction {
  medications: Medication[];
  diagnoses: Diagnosis[];
  labResults: LabResult[];
  allergies: Allergy[];
  hospital?: string;
  doctorName?: string;
  documentDate?: string;
  documentType?: string;
  language?: 'en' | 'ur' | 'mixed';
}
