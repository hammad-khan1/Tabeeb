import type {
  DoctorProfile,
  AttributedMedication,
  AttributedLabResult,
  DoctorSourceType,
  TreatmentRole,
  TreatmentStatus,
} from './types';

// Comprehensive list of medical specialties commonly seen in healthcare records
const SPECIALTY_PATTERNS: Array<{ pattern: RegExp; specialty: string }> = [
  { pattern: /\b(?:cardiolog(?:ist|y)|cardiac)\b/i, specialty: 'Cardiology' },
  { pattern: /\b(?:endocrinolog(?:ist|y)|diabetolog(?:ist|y)|diabetes)\b/i, specialty: 'Endocrinology & Diabetology' },
  { pattern: /\b(?:pulmonolog(?:ist|y)|chest\s*(?:physician|specialist)|respiratory)\b/i, specialty: 'Pulmonology' },
  { pattern: /\b(?:nephrolog(?:ist|y)|renal\s*(?:physician|specialist))\b/i, specialty: 'Nephrology' },
  { pattern: /\b(?:gastroenterolog(?:ist|y)|hepatolog(?:ist|y)|gi\s*specialist)\b/i, specialty: 'Gastroenterology' },
  { pattern: /\b(?:neurolog(?:ist|y)|neuro\s*physician)\b/i, specialty: 'Neurology' },
  { pattern: /\b(?:oncolog(?:ist|y)|cancer\s*specialist)\b/i, specialty: 'Oncology' },
  { pattern: /\b(?:dermatolog(?:ist|y)|skin\s*specialist)\b/i, specialty: 'Dermatology' },
  { pattern: /\b(?:orthopedic(?:s)?|ortho(?:paedic)?\s*surgeon)\b/i, specialty: 'Orthopedics' },
  { pattern: /\b(?:pediatric(?:ian|s)|paediatric(?:ian|s)|child\s*specialist)\b/i, specialty: 'Pediatrics' },
  { pattern: /\b(?:general\s*surgeon|surgery)\b/i, specialty: 'General Surgery' },
  { pattern: /\b(?:gynecolog(?:ist|y)|obstetric(?:s|ian)|obs\s*&?\s*gynae?)\b/i, specialty: 'Obstetrics & Gynecology' },
  { pattern: /\b(?:psychiatr(?:ist|y)|behavioral\s*health)\b/i, specialty: 'Psychiatry' },
  { pattern: /\b(?:urolog(?:ist|y))\b/i, specialty: 'Urology' },
  { pattern: /\b(?:ophthalmolog(?:ist|y)|eye\s*specialist)\b/i, specialty: 'Ophthalmology' },
  { pattern: /\b(?:rheumatolog(?:ist|y))\b/i, specialty: 'Rheumatology' },
  { pattern: /\b(?:ent\s*(?:specialist|surgeon)?|otolaryngolog(?:ist|y))\b/i, specialty: 'ENT (Otolaryngology)' },
  { pattern: /\b(?:internal\s*medicine|consultant\s*physician|general\s*physician)\b/i, specialty: 'Internal Medicine' },
  { pattern: /\b(?:family\s*(?:medicine|physician)|general\s*practitioner|gp)\b/i, specialty: 'General Practice' },
  { pattern: /\b(?:patholog(?:ist|y))\b/i, specialty: 'Pathology' },
];

const CONTACT_PATTERNS = [
  /(?:tel|phone|ph|mob(?:ile)?|cell)?[:.\s]*(\+?92[-.\s]?\d{3}[-.\s]?\d{7}|\b0\d{2,3}[-.\s]?\d{7,8}\b)/i,
  /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
];

export function normalizeDoctorName(rawName: string): string {
  return rawName
    .replace(/^(?:(?:dr\.?|prof\.?|doctor|consultant)\s+)+/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

export function detectSpecialty(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const { pattern, specialty } of SPECIALTY_PATTERNS) {
    if (pattern.test(text)) return specialty;
  }
  return null;
}

export function extractContactInfo(text: string | null | undefined): string | null {
  if (!text) return null;
  const contacts: string[] = [];
  for (const regex of CONTACT_PATTERNS) {
    const match = text.match(regex);
    if (match && match[1]) {
      contacts.push(match[1].trim());
    }
  }
  return contacts.length > 0 ? Array.from(new Set(contacts)).join(' · ') : null;
}

export function findPageNumber(rawText?: string | null, targetTerm?: string): number | null {
  if (!rawText) return null;

  // Patterns for page markers generated during OCR or multi-page text extraction:
  // e.g. "--- Page 1 of 3 ---", "-- Page 1 --", "[Page 1]", "Page 1 of 3"
  const pageHeaderPattern = /(?:[-=]{2,}\s*Page\s*(\d+)(?:\s*of\s*\d+)?\s*[-=]{2,}|\[\s*Page\s*(\d+)\s*(?:of\s*\d+)?\s*\]|\bPage\s*(\d+)\s+of\s+\d+\b)/gi;

  const matches = Array.from(rawText.matchAll(pageHeaderPattern));
  if (matches.length === 0) return null;

  if (!targetTerm || targetTerm.trim().length < 2) {
    const firstMatch = matches[0];
    const numStr = firstMatch[1] || firstMatch[2] || firstMatch[3];
    return numStr ? parseInt(numStr, 10) : 1;
  }

  const lowerTerm = targetTerm.toLowerCase();

  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const pageNumStr = currentMatch[1] || currentMatch[2] || currentMatch[3];
    const pageNum = pageNumStr ? parseInt(pageNumStr, 10) : i + 1;

    const startIndex = (currentMatch.index ?? 0) + currentMatch[0].length;
    const nextMatch = matches[i + 1];
    const endIndex = nextMatch?.index !== undefined ? nextMatch.index : rawText.length;

    const pageContent = rawText.slice(startIndex, endIndex);
    if (pageContent.toLowerCase().includes(lowerTerm)) {
      return pageNum;
    }
  }

  return null;
}

interface RawDocumentLike {
  id: string;
  title: string;
  fileName?: string | null;
  mimeType?: string | null;
  doctorName?: string | null;
  hospital?: string | null;
  documentDate?: Date | string | null;
  documentType: string;
  rawExtractedText?: string | null;
  structuredData?: unknown;
}

interface PatientDoctorRecord {
  id: string;
  name: string;
  specialty?: string | null;
  hospital?: string | null;
  contactInfo?: string | null;
  sourceType?: string | null;
  notes?: string | null;
}

export function buildDoctorProfiles(
  docs: RawDocumentLike[],
  patientDoctors: PatientDoctorRecord[] = []
): DoctorProfile[] {
  const profileMap = new Map<string, DoctorProfile>();

  // 1. First process document extractions
  for (const doc of docs) {
    const name = doc.doctorName?.trim();
    if (!name) continue;

    const normalized = normalizeDoctorName(name);
    if (!normalized || normalized.length < 2) continue;

    const fullText = [doc.rawExtractedText, doc.hospital, doc.title].filter(Boolean).join(' ');
    const detectedSpec = detectSpecialty(fullText);
    const contact = extractContactInfo(doc.rawExtractedText);
    const docDate = doc.documentDate ? new Date(doc.documentDate).toISOString().split('T')[0] : null;

    if (!profileMap.has(normalized)) {
      profileMap.set(normalized, {
        id: `extracted-${normalized}`,
        name,
        normalizedName: normalized,
        specialty: detectedSpec,
        hospital: doc.hospital ?? null,
        contactInfo: contact,
        sourceType: 'extracted',
        isVerified: false,
        sourceDocumentId: doc.id,
        sourceDocumentTitle: doc.title,
        consultationDates: docDate ? [docDate] : [],
        prescriptionsCount: doc.documentType === 'prescription' ? 1 : 0,
        labOrdersCount: doc.documentType === 'lab_report' ? 1 : 0,
        notes: null,
      });
    } else {
      const existing = profileMap.get(normalized)!;
      if (docDate && !existing.consultationDates.includes(docDate)) {
        existing.consultationDates.push(docDate);
        existing.consultationDates.sort().reverse();
      }
      if (doc.documentType === 'prescription') existing.prescriptionsCount += 1;
      if (doc.documentType === 'lab_report') existing.labOrdersCount += 1;
      if (!existing.specialty && detectedSpec) existing.specialty = detectedSpec;
      if (!existing.hospital && doc.hospital) existing.hospital = doc.hospital;
      if (!existing.contactInfo && contact) existing.contactInfo = contact;
    }
  }

  // 2. Merge with patient-entered doctors (overriding/enhancing where matched)
  for (const pd of patientDoctors) {
    const normalized = normalizeDoctorName(pd.name);
    if (!normalized) continue;

    const sourceType: DoctorSourceType =
      pd.sourceType === 'verified'
        ? 'verified'
        : pd.sourceType === 'patient_entered'
        ? 'patient_entered'
        : 'extracted';

    if (profileMap.has(normalized)) {
      const existing = profileMap.get(normalized)!;
      existing.id = pd.id;
      existing.name = pd.name; // Keep user's preferred casing
      if (pd.specialty) existing.specialty = pd.specialty;
      if (pd.hospital) existing.hospital = pd.hospital;
      if (pd.contactInfo) existing.contactInfo = pd.contactInfo;
      existing.sourceType = sourceType;
      existing.isVerified = sourceType === 'verified';
      if (pd.notes) existing.notes = pd.notes;
    } else {
      profileMap.set(normalized, {
        id: pd.id,
        name: pd.name,
        normalizedName: normalized,
        specialty: pd.specialty ?? null,
        hospital: pd.hospital ?? null,
        contactInfo: pd.contactInfo ?? null,
        sourceType,
        isVerified: sourceType === 'verified',
        sourceDocumentId: null,
        sourceDocumentTitle: null,
        consultationDates: [],
        prescriptionsCount: 0,
        labOrdersCount: 0,
        notes: pd.notes ?? null,
      });
    }
  }

  return Array.from(profileMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function attributePrescription(
  medication: {
    id: string;
    name: string;
    genericName?: string | null;
    dosage?: string | null;
    frequency?: string | null;
    duration?: string | null;
    route?: string | null;
    isActive?: boolean | null;
    prescribedDate?: Date | string | null;
  },
  doc: RawDocumentLike | undefined
): AttributedMedication {
  const docDate = doc?.documentDate
    ? new Date(doc.documentDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  const rawDoctor = doc?.doctorName?.trim();
  const isIdentified = Boolean(rawDoctor && rawDoctor.length > 1);

  const role: TreatmentRole =
    doc?.documentType === 'prescription'
      ? 'prescribing'
      : doc?.documentType === 'discharge_summary' || doc?.documentType === 'consultation_note'
      ? 'reviewing'
      : 'mentioned';

  const status: TreatmentStatus =
    medication.isActive === false
      ? 'discontinued'
      : medication.prescribedDate &&
        Date.now() - new Date(medication.prescribedDate).getTime() > 180 * 86400 * 1000
      ? 'historical'
      : 'active';

  const doctorSpecialty = detectSpecialty(
    [doc?.rawExtractedText, doc?.title, doc?.hospital].filter(Boolean).join(' ')
  );

  return {
    id: medication.id,
    name: medication.name,
    genericName: medication.genericName ?? null,
    dosage: medication.dosage ?? null,
    frequency: medication.frequency ?? null,
    duration: medication.duration ?? null,
    route: medication.route ?? null,
    prescribedDate: medication.prescribedDate
      ? new Date(medication.prescribedDate).toISOString()
      : null,
    status,
    prescribingDoctor: {
      name: isIdentified ? rawDoctor! : 'Doctor not identified in available records',
      specialty: doctorSpecialty,
      hospital: doc?.hospital ?? null,
      role,
      isIdentified,
    },
    hospital: doc?.hospital ?? null,
    sourceDocumentId: doc?.id ?? '',
    sourceDocumentTitle: doc?.title ?? 'Medical Record',
    sourceDocumentDate: docDate,
    sourceCitation: `${doc?.title ?? 'Document'}${docDate ? ` (${docDate})` : ''}`,
    pageNumber: findPageNumber(doc?.rawExtractedText, medication.name),
    mimeType: doc?.mimeType ?? null,
    changesNote:
      status === 'discontinued'
        ? 'Discontinued per records'
        : status === 'historical'
        ? 'Historical course; verify current intake'
        : null,
  };
}

export function attributeLabResult(
  lab: {
    id: string;
    testName: string;
    canonicalTestName?: string | null;
    value: string;
    numericValue?: number | null;
    unit?: string | null;
    referenceRange?: string | null;
    isAbnormal?: boolean | null;
    testDate: Date | string;
  },
  doc: RawDocumentLike | undefined
): AttributedLabResult {
  const docText = doc?.rawExtractedText ?? '';

  // Distinguish ordering doctor vs laboratory facility
  let orderingDoctorName: string | null = null;
  const referralMatch = docText.match(
    /(?:referred\s*by|ordered\s*by|dr\.?\s*in-?charge|consultant)[:\s]+(?:dr\.?\s*)?([A-Za-z\s]{3,35})(?:[\n.,;]|$)/i
  );
  if (referralMatch && referralMatch[1]) {
    orderingDoctorName = referralMatch[1].trim();
  } else if (doc?.doctorName) {
    orderingDoctorName = doc.doctorName.trim();
  }

  const isIdentified = Boolean(orderingDoctorName && orderingDoctorName.length > 2);
  const orderingDoctorSpecialty = detectSpecialty(docText);

  // Performing facility: Lab name from hospital or document
  let performingFacility = doc?.hospital ?? null;
  if (!performingFacility) {
    const labMatch = docText.match(/\b([A-Za-z\s]+(?:laboratory|laboratories|lab|diagnostic(?:s)?|pathology|imaging))\b/i);
    if (labMatch && labMatch[1]) {
      performingFacility = labMatch[1].trim();
    }
  }

  const docDate = doc?.documentDate
    ? new Date(doc.documentDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return {
    id: lab.id,
    testName: lab.testName,
    canonicalTestName: lab.canonicalTestName ?? null,
    value: lab.value,
    numericValue: lab.numericValue ?? null,
    unit: lab.unit ?? null,
    referenceRange: lab.referenceRange ?? null,
    isAbnormal: Boolean(lab.isAbnormal),
    testDate: new Date(lab.testDate).toISOString(),
    orderingDoctor: {
      name: isIdentified ? orderingDoctorName! : 'Doctor not identified in available records',
      specialty: orderingDoctorSpecialty,
      isIdentified,
    },
    performingFacility: performingFacility ?? 'Laboratory facility not specified',
    sourceDocumentId: doc?.id ?? '',
    sourceDocumentTitle: doc?.title ?? 'Laboratory Report',
    sourceCitation: `${doc?.title ?? 'Lab Report'}${docDate ? ` (${docDate})` : ''}`,
    pageNumber: findPageNumber(doc?.rawExtractedText, lab.testName),
    mimeType: doc?.mimeType ?? null,
  };
}
