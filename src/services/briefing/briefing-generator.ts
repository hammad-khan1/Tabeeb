import { eq, and, desc, gte, lte, inArray, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { getDb } from '@/lib/db';
import {
  users,
  documents,
  medications,
  diagnoses,
  labResults,
  allergies,
  patientDoctors,
} from '../../../drizzle/schema';
import type {
  PatientBriefingData,
  BriefingFilterOptions,
  LabTrend,
  TreatmentConflict,
  DoctorConsultationQuestion,
  BriefingUncertainty,
  DoctorTimelineEvent,
  EvidenceCitation,
  BriefingCondition,
  BriefingAllergy,
  BriefingConsultationPlan,
} from './types';
import {
  buildDoctorProfiles,
  attributePrescription,
  attributeLabResult,
  detectSpecialty,
  findPageNumber,
} from './doctor-tracker';

import { applyMedicationFindingReviews, medicationRecordFromRow } from '@/services/medications/repository';
import { evaluateMedicationSafety } from '@/services/medications/safety';
import { medicationStatus } from '@/services/medications/reconciliation';
import { isCurrentMedicationStatus } from '@/services/medications/workspace';

export async function generatePatientBriefing(
  userId: string,
  options: BriefingFilterOptions = {}
): Promise<PatientBriefingData> {
  const db = getDb();

  // 1. Fetch user profile
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const fromDate = options.from ? new Date(options.from) : null;
  const toDate = options.to ? new Date(options.to) : null;
  const scopedDocIds = options.documentIds ?? null;

  // Build document filter
  const docConditions: SQL[] = [eq(documents.userId, userId)];
  if (scopedDocIds) {
    docConditions.push(inArray(documents.id, scopedDocIds));
  }
  if (fromDate) {
    docConditions.push(gte(documents.documentDate, fromDate));
  }
  if (toDate) {
    docConditions.push(lte(documents.documentDate, toDate));
  }

  // 2. Query documents
  const docs = await db
    .select()
    .from(documents)
    .where(and(...docConditions))
    .orderBy(desc(documents.documentDate), desc(documents.createdAt))
    .limit(200);

  const docIdList = docs.map((d) => d.id);
  const docMap = new Map(docs.map((d) => [d.id, d]));

  // Handle empty records gracefully
  if (docs.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      dateRange: {
        from: options.from ?? null,
        to: options.to ?? null,
        isCoveredAllTime: !options.from && !options.to,
      },
      patient: {
        id: userId,
        name: user?.name ?? null,
        email: user?.email ?? '',
        preferredLanguage: user?.preferredLanguage ?? 'en',
      },
      clinicalSummary: 'No medical documents found matching the selected criteria.',
      conditions: [],
      doctors: [],
      currentMedications: [],
      historicalMedications: [],
      allergies: [],
      recentLabResults: [],
      labTrends: [],
      consultationsAndPlans: [],
      treatmentConflicts: [],
      uncertainties: [],
      consultationQuestions: [],
      doctorTimeline: [],
      citations: [],
      documentCount: 0,
      isPartial: Boolean(scopedDocIds || options.from || options.to),
    };
  }

  const scopeByDoc = (column: AnyPgColumn) => inArray(column, docIdList);

  // 3. Parallel query for all associated medical entities and patient doctors
  const [medRows, diagRows, labRows, allergyRows, pDoctors] = await Promise.all([
    db
      .select()
      .from(medications)
      .where(and(eq(medications.userId, userId), eq(medications.sourceActive, true), scopeByDoc(medications.documentId)))
      .orderBy(desc(medications.prescribedDate), desc(medications.createdAt))
      .limit(500),
    db
      .select()
      .from(diagnoses)
      .where(and(eq(diagnoses.userId, userId), scopeByDoc(diagnoses.documentId)))
      .orderBy(desc(diagnoses.diagnosedDate), desc(diagnoses.createdAt))
      .limit(100),
    db
      .select()
      .from(labResults)
      .where(and(eq(labResults.userId, userId), scopeByDoc(labResults.documentId)))
      .orderBy(desc(labResults.testDate), desc(labResults.createdAt))
      .limit(300),
    db
      .select()
      .from(allergies)
      .where(and(eq(allergies.userId, userId), scopeByDoc(allergies.documentId)))
      .limit(50),
    db
      .select()
      .from(patientDoctors)
      .where(and(eq(patientDoctors.userId, userId), scopedDocIds || options.from || options.to ? inArray(patientDoctors.sourceDocumentId, docIdList) : undefined))
      .limit(50),
  ]);

  // 4. Build Doctors Directory & Attribution
  const doctorProfiles = buildDoctorProfiles(docs, pDoctors);

  // Medication history and findings share the dashboard domain rules. Only selected
  // documents are evaluated so a scoped share cannot include withheld evidence.
  const medicationRecords = medRows.map((row) => {
    const doc = docMap.get(row.documentId);
    return medicationRecordFromRow(row, {
      id: doc?.id ?? row.documentId ?? '',
      title: doc?.title ?? 'Medical Document',
      documentType: doc?.documentType ?? 'prescription',
      documentDate: doc?.documentDate ? (doc.documentDate instanceof Date ? doc.documentDate.toISOString() : new Date(doc.documentDate).toISOString()) : null,
    });
  });
  const medicationSafety = await evaluateMedicationSafety(userId, medicationRecords, allergyRows.map((row) => ({
    id: row.id, userId, documentId: row.documentId,
    documentTitle: row.documentId ? docMap.get(row.documentId)?.title ?? null : null,
    allergen: row.allergen, reaction: row.reaction, severity: row.severity, assertionStatus: row.assertionStatus,
  })));
  medicationSafety.findings = await applyMedicationFindingReviews(userId, medicationSafety.findings);
  medicationSafety.limitations.push('This briefing evaluates only the displayed source records and their documented allergies. Patient-profile allergies and withheld records are outside this scope.');
  if (medRows.length === 500) medicationSafety.limitations.push('The medication section is capped at 500 source observations; older records may be excluded.');
  const allMedications = medRows.map((row, index) => {
    const record = medicationRecords[index];
    const status = medicationStatus(record);
    return {
      ...attributePrescription(row, docMap.get(row.documentId)),
      status: (isCurrentMedicationStatus(status) ? 'active' : status === 'discontinued' ? 'discontinued' : 'historical') as 'active' | 'historical' | 'discontinued',
      useStatus: status,
      patientCorrections: record.corrections,
      changesNote: record.patientStatus ? 'Status reported by patient; original prescription values retained.' : 'Current use has not been confirmed by the patient.',
    };
  });
  const currentMedications = allMedications.filter((med) => isCurrentMedicationStatus(med.useStatus));
  const historicalMedications = allMedications.filter((med) => !isCurrentMedicationStatus(med.useStatus));

  // 6. Attributed Lab Results
  const attributedLabs = labRows.map((l) => attributeLabResult(l, docMap.get(l.documentId)));

  // 7. Calculate Lab Trends across comparable tests
  const labGroups = new Map<string, typeof attributedLabs>();
  for (const lab of attributedLabs) {
    const key = (lab.canonicalTestName || lab.testName).toLowerCase().trim();
    if (!labGroups.has(key)) {
      labGroups.set(key, []);
    }
    labGroups.get(key)!.push(lab);
  }

  const labTrends: LabTrend[] = [];
  for (const [, readings] of labGroups.entries()) {
    // Sort oldest to newest for trend analysis
    const sorted = [...readings].sort(
      (a, b) => new Date(a.testDate).getTime() - new Date(b.testDate).getTime()
    );
    const latest = sorted[sorted.length - 1];
    const previous = sorted.length > 1 ? sorted[sorted.length - 2] : null;

    let delta: number | null = null;
    let percentageChange: number | null = null;
    let direction: LabTrend['direction'] = 'single_reading';
    let clinicalNote = latest.isAbnormal ? 'Current value outside reference range.' : 'Within normal limits.';

    if (previous && latest.numericValue != null && previous.numericValue != null) {
      delta = Number((latest.numericValue - previous.numericValue).toFixed(2));
      if (previous.numericValue !== 0) {
        percentageChange = Number(
          (((latest.numericValue - previous.numericValue) / Math.abs(previous.numericValue)) * 100).toFixed(1)
        );
      }

      if (Math.abs(delta) < 0.05) {
        direction = 'stable';
        clinicalNote = 'Values have remained stable across tests.';
      } else if (latest.isAbnormal && !previous.isAbnormal) {
        direction = 'worsened';
        clinicalNote = `Transitioned from normal (${previous.value}) to abnormal (${latest.value}).`;
      } else if (!latest.isAbnormal && previous.isAbnormal) {
        direction = 'improved';
        clinicalNote = `Normalized from abnormal (${previous.value}) to normal range.`;
      } else if (delta > 0) {
        direction = 'increased';
        clinicalNote = `Increased by ${delta} ${latest.unit || ''} (${percentageChange ?? ''}%).`;
      } else {
        direction = 'decreased';
        clinicalNote = `Decreased by ${Math.abs(delta)} ${latest.unit || ''} (${percentageChange ?? ''}%).`;
      }
    }

    labTrends.push({
      testName: latest.testName,
      canonicalTestName: latest.canonicalTestName,
      unit: latest.unit,
      referenceRange: latest.referenceRange,
      latestValue: latest.value,
      latestNumeric: latest.numericValue,
      latestDate: latest.testDate,
      latestIsAbnormal: latest.isAbnormal,
      previousValue: previous?.value ?? null,
      previousNumeric: previous?.numericValue ?? null,
      previousDate: previous?.testDate ?? null,
      delta,
      percentageChange,
      direction,
      clinicalNote,
      readingsCount: sorted.length,
    });
  }

  // Legacy hardcoded class/interaction claims are replaced by evidence-backed
  // medicationSafety findings. No locally invented class or severity remains.
  const treatmentConflicts: TreatmentConflict[] = [];

  // 9. Document Uncertainties & Missing Information
  const uncertainties: BriefingUncertainty[] = [];
  for (const med of currentMedications) {
    if (!med.dosage || !med.frequency) {
      uncertainties.push({
        category: 'unclear_instructions',
        detail: `Medication "${med.name}" does not specify complete dosage or frequency instructions.`,
        impact: 'Documentation needs verification with the source and prescribing clinician.',
      });
    }
    if (!med.prescribingDoctor.isIdentified) {
      uncertainties.push({
        category: 'missing_records',
        detail: `Prescribing doctor for "${med.name}" is not identified in the uploaded records.`,
        impact: 'Doctor accountability and follow-up provider are unconfirmed.',
      });
    }
  }

  for (const lab of attributedLabs) {
    if (!lab.referenceRange) {
      uncertainties.push({
        category: 'missing_records',
        detail: `Lab test "${lab.testName}" (${lab.value}) has no documented reference range.`,
        impact: 'Clinical significance cannot be independently benchmarked without local lab standards.',
      });
    }
  }

  // 10. Generate Doctor Consultation Questions
  const consultationQuestions: DoctorConsultationQuestion[] = [];

  // Questions from treatment conflicts
  for (const conflict of treatmentConflicts) {
    consultationQuestions.push({
      id: `q-${conflict.id}`,
      category: 'medication_conflict',
      question: `Are "${conflict.involvedMedications.join('" and "')}" intended to be taken concurrently, or did one replace the previous prescription?`,
      rationale: conflict.description,
      relevantDoctor: conflict.involvedDoctors[0] ?? null,
      sourceCitations: conflict.sourceCitations,
    });
  }

  // Questions from abnormal lab trends
  for (const trend of labTrends) {
    if (trend.latestIsAbnormal || trend.direction === 'worsened') {
      consultationQuestions.push({
        id: `q-lab-${trend.testName.toLowerCase().replace(/\s+/g, '-')}`,
        category: 'lab_trend',
        question: `My recent ${trend.testName} was ${trend.latestValue}${trend.unit ? ` ${trend.unit}` : ''}${
          trend.previousValue ? ` (changed from ${trend.previousValue})` : ''
        }. Does this require any adjustment to my current treatment plan?`,
        rationale: trend.clinicalNote,
        relevantDoctor: null,
        sourceCitations: [`Lab result on ${new Date(trend.latestDate).toLocaleDateString()}`],
      });
    }
  }

  // Questions from unclear medication instructions
  for (const med of currentMedications) {
    if (!med.dosage || !med.frequency) {
      consultationQuestions.push({
        id: `q-dose-${med.name.toLowerCase().replace(/\s+/g, '-')}`,
        category: 'missing_info',
        question: `What is the exact dosage and schedule I should follow for ${med.name}?`,
        rationale: 'Dosage or timing is not completely documented in available prescription records.',
        relevantDoctor: med.prescribingDoctor.name,
        sourceCitations: [med.sourceCitation],
      });
    }
  }

  // 11. Doctor-wise Timeline
  const doctorTimeline: DoctorTimelineEvent[] = [];

  for (const doc of docs) {
    const dateStr = doc.documentDate?.toISOString() ?? null;
    const docDoctor = doc.doctorName || 'Doctor not identified in available records';
    const spec = detectSpecialty([doc.rawExtractedText, doc.hospital, doc.title].filter(Boolean).join(' '));
    const docPage = findPageNumber(doc.rawExtractedText);

    if (doc.documentType === 'prescription') {
      doctorTimeline.push({
        id: `event-rx-${doc.id}`,
        date: dateStr,
        type: 'prescription',
        title: `Prescription issued: ${doc.title}`,
        description: `Prescription issued by ${docDoctor}${doc.hospital ? ` at ${doc.hospital}` : ''}.`,
        doctorName: docDoctor,
        doctorSpecialty: spec,
        hospital: doc.hospital ?? null,
        sourceDocumentId: doc.id,
        sourceDocumentTitle: doc.title,
        pageNumber: docPage,
        mimeType: doc.mimeType ?? null,
      });
    } else if (doc.documentType === 'consultation_note' || doc.documentType === 'discharge_summary') {
      doctorTimeline.push({
        id: `event-consult-${doc.id}`,
        date: dateStr,
        type: 'consultation',
        title: `Clinical Consultation: ${doc.title}`,
        description: `Consultation documented by ${docDoctor}. Summary: ${doc.summary ? doc.summary.slice(0, 160) + '...' : 'Review documented.'}`,
        doctorName: docDoctor,
        doctorSpecialty: spec,
        hospital: doc.hospital ?? null,
        sourceDocumentId: doc.id,
        sourceDocumentTitle: doc.title,
        pageNumber: docPage,
        mimeType: doc.mimeType ?? null,
      });
    } else if (doc.documentType === 'lab_report') {
      doctorTimeline.push({
        id: `event-lab-${doc.id}`,
        date: dateStr,
        type: 'lab_result',
        title: `Diagnostic Report: ${doc.title}`,
        description: `Laboratory tests completed${doc.hospital ? ` at ${doc.hospital}` : ''}${doc.doctorName ? ` (referred by ${doc.doctorName})` : ''}.`,
        doctorName: docDoctor,
        doctorSpecialty: spec,
        hospital: doc.hospital ?? null,
        sourceDocumentId: doc.id,
        sourceDocumentTitle: doc.title,
        pageNumber: docPage,
        mimeType: doc.mimeType ?? null,
      });
    }
  }

  // Sort timeline newest first
  doctorTimeline.sort((a, b) =>
    (b.date ? new Date(b.date).getTime() : -Infinity) -
    (a.date ? new Date(a.date).getTime() : -Infinity));

  // 12. Evidence Citations
  const citations: EvidenceCitation[] = docs.map((doc, i) => {
    const docDate = doc.documentDate
      ? new Date(doc.documentDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : null;

    const docDoctor = doc.doctorName ? doc.doctorName.trim() : null;
    const spec = detectSpecialty([doc.rawExtractedText, doc.hospital, doc.title].filter(Boolean).join(' '));
    const pageNum = findPageNumber(doc.rawExtractedText);

    return {
      index: i + 1,
      documentId: doc.id,
      documentTitle: doc.title,
      fileName: doc.fileName ?? null,
      mimeType: doc.mimeType ?? null,
      documentDate: docDate,
      documentType: doc.documentType,
      pageNumber: pageNum,
      doctorName: docDoctor,
      doctorSpecialty: spec,
      hospital: doc.hospital ?? null,
      excerpt: doc.summary || (doc.rawExtractedText ? doc.rawExtractedText.slice(0, 240) + '...' : 'Clinical record on file.'),
      doctorAttributionEvidence: docDoctor
        ? `Attributed to ${docDoctor} based on documented signature/header on ${doc.title}.`
        : 'Doctor not identified in available records.',
    };
  });

  const citationMap = new Map<string, number>(citations.map((c) => [c.documentId, c.index]));

  // Link citation indices
  for (const m of allMedications) {
    m.citationIndex = citationMap.get(m.sourceDocumentId);
  }
  for (const l of attributedLabs) {
    l.citationIndex = citationMap.get(l.sourceDocumentId);
  }
  for (const trend of labTrends) {
    const matchingLab = attributedLabs.find(
      (l) => (l.canonicalTestName || l.testName).toLowerCase() === (trend.canonicalTestName || trend.testName).toLowerCase()
    );
    if (matchingLab) {
      trend.sourceDocumentId = matchingLab.sourceDocumentId;
      trend.citationIndex = citationMap.get(matchingLab.sourceDocumentId);
    }
  }

  // 13. Conditions and Allergies mapping
  const conditions: BriefingCondition[] = diagRows.map((d) => {
    const parentDoc = docMap.get(d.documentId);
    return {
      id: d.id,
      condition: d.condition,
      canonicalCondition: d.canonicalCondition ?? null,
      icd10Code: d.icd10Code ?? null,
      severity: d.severity ?? null,
      assertionStatus: d.assertionStatus ?? 'present',
      diagnosedDate: d.diagnosedDate ? new Date(d.diagnosedDate).toISOString() : null,
      diagnosingDoctor: parentDoc?.doctorName ?? null,
      hospital: parentDoc?.hospital ?? null,
      sourceDocumentId: d.documentId,
      sourceDocumentTitle: parentDoc?.title ?? 'Medical Document',
      citationIndex: citationMap.get(d.documentId),
      pageNumber: findPageNumber(parentDoc?.rawExtractedText, d.condition),
      mimeType: parentDoc?.mimeType ?? null,
    };
  });

  const briefingAllergies: BriefingAllergy[] = allergyRows.map((a) => {
    const parentDoc = a.documentId ? docMap.get(a.documentId) : undefined;
    return {
      allergen: a.allergen,
      allergyType: a.allergyType ?? null,
      severity: a.severity ?? null,
      reaction: a.reaction ?? null,
      sourceDocumentId: a.documentId ?? null,
      sourceDocumentTitle: parentDoc?.title ?? null,
      citationIndex: a.documentId ? citationMap.get(a.documentId) : undefined,
    };
  });

  // 14. Consultations & Treatment Plans
  const consultationsAndPlans: BriefingConsultationPlan[] = docs
    .filter((d) => d.documentType === 'consultation_note' || d.documentType === 'discharge_summary')
    .map((d) => ({
      id: d.id,
      date: d.documentDate?.toISOString() ?? null,
      doctorName: d.doctorName || 'Doctor not identified in available records',
      specialty: detectSpecialty([d.rawExtractedText, d.hospital, d.title].filter(Boolean).join(' ')),
      hospital: d.hospital ?? null,
      planSummary: d.summary || (d.rawExtractedText ? d.rawExtractedText.slice(0, 300) : 'Consultation documented.'),
      followUpInstructions: d.rawExtractedText?.match(/follow.?up[:\s]+([^\n.]+)/i)?.[1]?.trim() ?? null,
      sourceDocumentTitle: d.title,
    }));

  // 15. Formulate Clinical Summary Overview
  const activeMedCount = currentMedications.filter((med) => med.useStatus === 'confirmed_current').length;
  const unconfirmedMedCount = currentMedications.length - activeMedCount;
  const activeDocCount = doctorProfiles.length;
  const abnormalLabCount = attributedLabs.filter((l) => l.isAbnormal).length;
  const conflictCount = medicationSafety.findings.filter((finding) => ['reconciliation_difference', 'conflicting_instructions', 'ingredient_duplication', 'allergy_concern'].includes(finding.category)).length;

  const clinicalSummary = `Comprehensive Doctor-Ready Briefing for ${user?.name || 'Patient'} covering ${docs.length} record${
    docs.length === 1 ? '' : 's'
  }. Documented care involves ${activeDocCount} identifiable healthcare professional${
    activeDocCount === 1 ? '' : 's'
  } across ${doctorProfiles.map((d) => d.specialty || d.name).slice(0, 3).join(', ') || 'multiple specialties'}. There are ${activeMedCount} patient-confirmed current medication${
    activeMedCount === 1 ? '' : 's'
  }, ${unconfirmedMedCount} prescriptions or medication records with unconfirmed use, and ${conditions.length} documented clinical condition${conditions.length === 1 ? '' : 's'}.${
    abnormalLabCount > 0 ? ` ${abnormalLabCount} laboratory finding(s) outside reference ranges require review.` : ''
  }${conflictCount > 0 ? ` ${conflictCount} medication finding(s) flagged for professional verification.` : ''}`;

  return {
    generatedAt: new Date().toISOString(),
    dateRange: {
      from: options.from ?? null,
      to: options.to ?? null,
      isCoveredAllTime: !options.from && !options.to,
    },
    patient: {
      id: userId,
      name: user?.name ?? null,
      email: user?.email ?? '',
      preferredLanguage: user?.preferredLanguage ?? 'en',
    },
    clinicalSummary,
    medicationSafety,
    conditions,
    doctors: doctorProfiles,
    currentMedications,
    historicalMedications,
    allergies: briefingAllergies,
    recentLabResults: attributedLabs.slice(0, 30),
    labTrends,
    consultationsAndPlans,
    treatmentConflicts,
    uncertainties: uncertainties.slice(0, 20),
    consultationQuestions,
    doctorTimeline,
    citations,
    documentCount: docs.length,
    isPartial: Boolean(scopedDocIds || options.from || options.to),
  };
}
