import { describe, it, expect } from 'vitest';
import {
  normalizeDoctorName,
  detectSpecialty,
  extractContactInfo,
  buildDoctorProfiles,
  attributePrescription,
  attributeLabResult,
  findPageNumber,
} from './doctor-tracker';
import { generateBriefingPdf } from './pdf-generator';
import type { PatientBriefingData } from './types';

describe('Doctor Reference Tracking & Identification', () => {
  it('normalizes doctor names by stripping honorifics and punctuation', () => {
    expect(normalizeDoctorName('Dr. Tariq Mahmood')).toBe('tariq mahmood');
    expect(normalizeDoctorName('Prof. Dr. Ayesha Khan, MD')).toBe('ayesha khan md');
    expect(normalizeDoctorName('Consultant Imran Ali')).toBe('imran ali');
    expect(normalizeDoctorName('Doctor Fatima Zahra')).toBe('fatima zahra');
  });

  it('detects clinical specialties from document context', () => {
    expect(detectSpecialty('Consultant Cardiologist at Punjab Institute')).toBe('Cardiology');
    expect(detectSpecialty('Department of Endocrinology and Diabetology')).toBe('Endocrinology & Diabetology');
    expect(detectSpecialty('Pulmonology & Chest Clinic')).toBe('Pulmonology');
    expect(detectSpecialty('Consultant Nephrologist')).toBe('Nephrology');
    expect(detectSpecialty('General Surgeon OPD')).toBe('General Surgery');
    expect(detectSpecialty('No clear specialty mentioned')).toBeNull();
  });

  it('extracts Pakistani phone numbers and email contacts from document text', () => {
    const text = 'Shifa Clinic, Ph: 0300-1234567, email: info@shifaclinic.com';
    const contacts = extractContactInfo(text);
    expect(contacts).toContain('0300-1234567');
    expect(contacts).toContain('info@shifaclinic.com');
  });

  it('builds distinct doctor profiles for multiple doctors without merging different people', () => {
    const docs = [
      {
        id: 'doc-1',
        title: 'Cardiac Rx',
        doctorName: 'Dr. Tariq Mahmood',
        hospital: 'National Hospital',
        documentDate: new Date('2025-01-15'),
        documentType: 'prescription',
        rawExtractedText: 'Consultant Cardiologist Tel: 042-35718222',
      },
      {
        id: 'doc-2',
        title: 'Endo Consultation',
        doctorName: 'Dr. Ayesha Tariq',
        hospital: 'Shaukat Khanum',
        documentDate: new Date('2025-02-10'),
        documentType: 'consultation_note',
        rawExtractedText: 'Diabetologist and Endocrinologist',
      },
    ];

    const profiles = buildDoctorProfiles(docs);
    expect(profiles).toHaveLength(2);

    const tariq = profiles.find((p) => p.name === 'Dr. Tariq Mahmood');
    expect(tariq).toBeDefined();
    expect(tariq?.specialty).toBe('Cardiology');
    expect(tariq?.hospital).toBe('National Hospital');
    expect(tariq?.contactInfo).toContain('042-35718222');
    expect(tariq?.prescriptionsCount).toBe(1);

    const ayesha = profiles.find((p) => p.name === 'Dr. Ayesha Tariq');
    expect(ayesha).toBeDefined();
    expect(ayesha?.specialty).toBe('Endocrinology & Diabetology');
    expect(ayesha?.hospital).toBe('Shaukat Khanum');
  });

  it('merges patient-entered doctor records with priority and preserves verification status', () => {
    const docs = [
      {
        id: 'doc-1',
        title: 'Prescription',
        doctorName: 'Dr. Tariq Mahmood',
        documentType: 'prescription',
      },
    ];

    const patientDoctors = [
      {
        id: 'pd-1',
        name: 'Dr. Tariq Mahmood',
        specialty: 'Interventional Cardiology',
        hospital: 'Doctors Hospital Lahore',
        contactInfo: '0300-9999999',
        sourceType: 'patient_entered',
        notes: 'Clinic on Tuesday/Thursday',
      },
    ];

    const profiles = buildDoctorProfiles(docs, patientDoctors);
    expect(profiles).toHaveLength(1);
    const doc = profiles[0];
    expect(doc.name).toBe('Dr. Tariq Mahmood');
    expect(doc.specialty).toBe('Interventional Cardiology');
    expect(doc.hospital).toBe('Doctors Hospital Lahore');
    expect(doc.contactInfo).toBe('0300-9999999');
    expect(doc.sourceType).toBe('patient_entered');
    expect(doc.notes).toBe('Clinic on Tuesday/Thursday');
    expect(doc.isVerified).toBe(false); // Never claimed verified without evidence
  });
});

describe('Prescription Attribution & Doctor Tracking', () => {
  it('attributes medication to the prescribing doctor when documented on a prescription', () => {
    const med = {
      id: 'med-1',
      name: 'Atorvastatin',
      genericName: 'Atorvastatin Calcium',
      dosage: '20mg',
      frequency: 'once at night',
      isActive: true,
      prescribedDate: new Date(),
    };
    const doc = {
      id: 'doc-1',
      title: 'Cardiology Prescription',
      doctorName: 'Dr. Bilal Siddiqui',
      hospital: 'Aga Khan Hospital',
      documentDate: new Date('2025-01-10'),
      documentType: 'prescription',
      rawExtractedText: 'Cardiologist',
    };

    const attr = attributePrescription(med, doc);
    expect(attr.prescribingDoctor.name).toBe('Dr. Bilal Siddiqui');
    expect(attr.prescribingDoctor.role).toBe('prescribing');
    expect(attr.prescribingDoctor.isIdentified).toBe(true);
    expect(attr.hospital).toBe('Aga Khan Hospital');
    expect(attr.status).toBe('active');
  });

  it('explicitly outputs "Doctor not identified in available records" when doctor is missing', () => {
    const med = {
      id: 'med-2',
      name: 'Panadol',
      dosage: '500mg',
    };
    const doc = {
      id: 'doc-2',
      title: 'Pharmacy Slip',
      documentType: 'other',
    };

    const attr = attributePrescription(med, doc);
    expect(attr.prescribingDoctor.name).toBe('Doctor not identified in available records');
    expect(attr.prescribingDoctor.isIdentified).toBe(false);
  });

  it('preserves distinction between active, historical, and discontinued treatments', () => {
    const discontinuedMed = {
      id: 'med-3',
      name: 'Captopril',
      isActive: false,
    };
    const doc = {
      id: 'doc-3',
      title: 'Past Rx',
      doctorName: 'Dr. Zafar',
      documentType: 'prescription',
    };

    const attr = attributePrescription(discontinuedMed, doc);
    expect(attr.status).toBe('discontinued');
    expect(attr.changesNote).toContain('Discontinued per records');
  });
});

describe('Laboratory Test Attribution', () => {
  it('attributes test to ordering doctor and distinguishes performing laboratory facility', () => {
    const lab = {
      id: 'lab-1',
      testName: 'HbA1c',
      canonicalTestName: 'hba1c',
      value: '7.2',
      numericValue: 7.2,
      unit: '%',
      referenceRange: '4.0 - 5.6',
      isAbnormal: true,
      testDate: new Date('2025-01-20'),
    };
    const doc = {
      id: 'doc-lab-1',
      title: 'Diagnostic Report',
      hospital: 'Chughtai Healthcare Diagnostic Laboratory',
      documentDate: new Date('2025-01-20'),
      documentType: 'lab_report',
      rawExtractedText: 'Referred by Dr. Usman Haider. Chughtai Laboratories Lahore.',
    };

    const attr = attributeLabResult(lab, doc);
    expect(attr.orderingDoctor.name).toBe('Usman Haider');
    expect(attr.orderingDoctor.isIdentified).toBe(true);
    expect(attr.performingFacility).toContain('Chughtai');
    expect(attr.isAbnormal).toBe(true);
  });

  it('indicates when ordering doctor is not documented in laboratory record', () => {
    const lab = {
      id: 'lab-2',
      testName: 'Complete Blood Picture',
      value: '13.5',
      testDate: new Date('2025-02-01'),
    };
    const doc = {
      id: 'doc-lab-2',
      title: 'Blood CBC',
      hospital: 'Excel Labs',
      documentType: 'lab_report',
      rawExtractedText: 'Specimen collected at Gulberg branch.',
    };

    const attr = attributeLabResult(lab, doc);
    expect(attr.orderingDoctor.name).toBe('Doctor not identified in available records');
    expect(attr.orderingDoctor.isIdentified).toBe(false);
    expect(attr.performingFacility).toBe('Excel Labs');
  });
});

describe('PDF Briefing Generator', () => {
  it('generates a valid binary PDF document conforming to PDF-1.4 standard', () => {
    const mockBriefing: PatientBriefingData = {
      generatedAt: new Date().toISOString(),
      dateRange: { from: '2025-01-01', to: '2025-03-01', isCoveredAllTime: false },
      patient: {
        id: 'patient-test-123',
        name: 'Kamran Akram',
        email: 'kamran@example.com',
        preferredLanguage: 'en',
      },
      clinicalSummary: 'Test clinical summary for patient briefing.',
      conditions: [
        {
          id: 'c1',
          condition: 'Type 2 Diabetes Mellitus',
          icd10Code: 'E11',
          severity: 'Moderate',
          assertionStatus: 'present',
          diagnosedDate: '2024-05-10',
          diagnosingDoctor: 'Dr. Tariq',
          hospital: 'National Hospital',
          sourceDocumentId: 'doc-1',
          sourceDocumentTitle: 'Initial Consultation',
        },
      ],
      doctors: [
        {
          id: 'd1',
          name: 'Tariq Mahmood',
          normalizedName: 'tariq mahmood',
          specialty: 'Cardiology',
          hospital: 'National Hospital',
          contactInfo: '042-35718222',
          sourceType: 'extracted',
          isVerified: false,
          sourceDocumentId: 'doc-1',
          sourceDocumentTitle: 'Initial Consultation',
          consultationDates: ['2025-01-15'],
          prescriptionsCount: 1,
          labOrdersCount: 1,
          notes: null,
        },
      ],
      currentMedications: [
        {
          id: 'm1',
          name: 'Metformin',
          genericName: 'Metformin Hydrochloride',
          dosage: '500mg',
          frequency: 'twice daily',
          duration: '30 days',
          route: 'oral',
          prescribedDate: '2025-01-15',
          status: 'active',
          prescribingDoctor: {
            name: 'Dr. Tariq Mahmood',
            specialty: 'Cardiology',
            hospital: 'National Hospital',
            role: 'prescribing',
            isIdentified: true,
          },
          hospital: 'National Hospital',
          sourceDocumentId: 'doc-1',
          sourceDocumentTitle: 'Initial Consultation',
          sourceDocumentDate: '15 Jan 2025',
          sourceCitation: 'Initial Consultation (15 Jan 2025)',
        },
      ],
      historicalMedications: [],
      allergies: [
        {
          allergen: 'Penicillin',
          allergyType: 'drug',
          severity: 'severe',
          reaction: 'Anaphylaxis',
        },
      ],
      recentLabResults: [],
      labTrends: [
        {
          testName: 'HbA1c',
          canonicalTestName: 'hba1c',
          unit: '%',
          referenceRange: '4.0 - 5.6',
          latestValue: '7.8',
          latestNumeric: 7.8,
          latestDate: '2025-02-01',
          latestIsAbnormal: true,
          previousValue: '6.5',
          previousNumeric: 6.5,
          previousDate: '2024-08-01',
          delta: 1.3,
          percentageChange: 20.0,
          direction: 'worsened',
          clinicalNote: 'Increased from 6.5 to 7.8 %.',
          readingsCount: 2,
        },
      ],
      consultationsAndPlans: [],
      treatmentConflicts: [
        {
          id: 'conf-1',
          type: 'duplicate_therapy',
          severity: 'high',
          title: 'Duplicate NSAID Therapy',
          description: 'Brufen and Voltral prescribed simultaneously.',
          involvedDoctors: ['Dr. Tariq Mahmood'],
          involvedMedications: ['Brufen', 'Voltral'],
          sourceCitations: ['Prescription A'],
          recommendation: 'Review concurrent use with prescribing doctor.',
        },
      ],
      uncertainties: [
        {
          category: 'missing_records',
          detail: 'No kidney function test in past 12 months.',
          impact: 'Renal monitoring advised with Metformin therapy.',
        },
      ],
      consultationQuestions: [
        {
          id: 'q1',
          category: 'medication_conflict',
          question: 'Should I stop Brufen while taking Voltral?',
          rationale: 'Concurrent NSAID use elevates GI bleeding risk.',
          relevantDoctor: 'Dr. Tariq Mahmood',
          sourceCitations: ['Prescription A'],
        },
      ],
      doctorTimeline: [
        {
          id: 'ev-1',
          date: '2025-01-15T00:00:00.000Z',
          type: 'prescription',
          title: 'Prescription for Metformin',
          description: 'Issued by Dr. Tariq Mahmood',
          doctorName: 'Dr. Tariq Mahmood',
          doctorSpecialty: 'Cardiology',
          hospital: 'National Hospital',
          sourceDocumentId: 'doc-1',
          sourceDocumentTitle: 'Initial Consultation',
        },
      ],
      citations: [
        {
          index: 1,
          documentId: 'doc-1',
          documentTitle: 'Initial Consultation',
          documentDate: '15 Jan 2025',
          documentType: 'consultation_note',
          doctorName: 'Dr. Tariq Mahmood',
          doctorSpecialty: 'Cardiology',
          hospital: 'National Hospital',
          excerpt: 'Patient presents for diabetes review.',
          doctorAttributionEvidence: 'Documented header on Initial Consultation.',
        },
      ],
      documentCount: 1,
      isPartial: false,
    };

    const buffer = generateBriefingPdf(mockBriefing);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(500);

    const pdfString = buffer.toString('ascii');
    expect(pdfString.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfString).toContain('/Type /Catalog');
    expect(pdfString).toContain('/Type /Pages');
    expect(pdfString).toContain('TABEEB HEALTH COMPANION');
    expect(pdfString).toContain('Kamran Akram');
    expect(pdfString).toContain('Page 1 of');
    expect(pdfString).toContain('CLINICAL LEGAL DISCLAIMER');
  });

  it('handles long table cell text wrapping and multi-page table pagination gracefully', () => {
    // Generate a briefing with many doctors and long strings that trigger multi-page splitting and cell wrapping
    const longBriefing: PatientBriefingData = {
      generatedAt: new Date().toISOString(),
      dateRange: { from: '2024-01-01', to: '2026-10-15', isCoveredAllTime: true },
      patient: {
        id: 'patient-complex-999',
        name: 'Fatima Zahra Khan',
        email: 'fatima@example.com',
        preferredLanguage: 'en',
      },
      clinicalSummary: 'Patient with multiple chronic conditions and complex polypharmacy across multiple specialty consultations.',
      conditions: Array.from({ length: 8 }, (_, i) => ({
        id: `c-${i}`,
        condition: `Chronic Condition Diagnosed with Detailed Clinical Manifestations #${i + 1}`,
        icd10Code: `E1${i}.9`,
        severity: 'Moderate to High',
        assertionStatus: 'confirmed',
        diagnosedDate: '2024-06-12',
        diagnosingDoctor: 'Dr. Muhammad Tariq Khan',
        hospital: 'Lady Reading Hospital Peshawar Medical Complex Regional Healthcare Center',
        sourceDocumentId: `doc-${i}`,
        sourceDocumentTitle: `Comprehensive Discharge Evaluation Summary Report #${i + 1}`,
        citationIndex: i + 1,
      })),
      doctors: Array.from({ length: 12 }, (_, i) => ({
        id: `doc-prof-${i}`,
        name: `Muhammad Tariq Khan ${i + 1}`,
        normalizedName: `muhammad tariq khan ${i + 1}`,
        specialty: 'Internal Medicine, Pulmonology & Critical Care',
        hospital: 'Lady Reading Hospital Peshawar; THQ Hospital Kabul; Khyber Teaching Hospital',
        contactInfo: '0300-1234567 / 091-5844444',
        sourceType: 'extracted',
        isVerified: i % 2 === 0,
        sourceDocumentId: `doc-${i}`,
        sourceDocumentTitle: `Clinical Consultation Note #${i + 1}`,
        consultationDates: ['2025-03-10'],
        prescriptionsCount: 3,
        labOrdersCount: 2,
        notes: null,
      })),
      currentMedications: Array.from({ length: 8 }, (_, i) => ({
        id: `med-${i}`,
        name: `Extended-Release Glucophage Formulation #${i + 1}`,
        genericName: 'Metformin Hydrochloride Controlled-Release Polymer',
        dosage: '1000mg twice daily with evening meals followed by fasting check',
        frequency: 'Every 12 hours after full meal',
        duration: 'Indefinite ongoing maintenance',
        route: 'oral',
        prescribedDate: '2025-01-10',
        status: 'active',
        prescribingDoctor: {
          name: 'Dr. Muhammad Tariq Khan',
          specialty: 'Endocrinology and Metabolic Disorders',
          hospital: 'Lady Reading Hospital Peshawar',
          role: 'prescribing',
          isIdentified: true,
        },
        hospital: 'Lady Reading Hospital Peshawar',
        sourceDocumentId: `doc-${i}`,
        sourceDocumentTitle: `Longitudinal Multi-Center Prescription Document #${i + 1}`,
        sourceDocumentDate: '2025-01-10',
        sourceCitation: `Prescription #${i + 1}`,
        citationIndex: i + 1,
      })),
      historicalMedications: [],
      allergies: [
        {
          allergen: 'Ceftriaxone Sodium Complex',
          allergyType: 'drug',
          severity: 'severe',
          reaction: 'Severe urticaria and facial angioedema',
        },
      ],
      recentLabResults: [
        {
          id: 'rl-1',
          testName: 'High Sensitivity C-Reactive Protein (hs-CRP)',
          canonicalTestName: 'hs_crp',
          value: '8.4',
          numericValue: 8.4,
          unit: 'mg/L',
          referenceRange: '0.0 - 3.0',
          isAbnormal: true,
          testDate: '2026-09-01',
          orderingDoctor: { name: 'Dr. Tariq Khan', specialty: 'Internal Medicine', isIdentified: true },
          performingFacility: 'Chughtai Diagnostic Center Peshawar',
          sourceDocumentId: 'doc-1',
          sourceDocumentTitle: 'Lab Report 1',
          sourceCitation: 'Lab Report',
          citationIndex: 1,
        },
      ],
      labTrends: Array.from({ length: 6 }, (_, i) => ({
        testName: `High Sensitivity Glycated Hemoglobin Fraction Analyte #${i + 1}`,
        canonicalTestName: `hba1c_${i}`,
        unit: 'mmol/mol',
        referenceRange: '20 - 42 mmol/mol',
        latestValue: '68',
        latestNumeric: 68,
        latestDate: '2026-09-01',
        latestIsAbnormal: true,
        previousValue: '54',
        previousNumeric: 54,
        previousDate: '2025-12-01',
        delta: 14,
        percentageChange: 25.9,
        direction: 'worsened',
        clinicalNote: 'Marked glycemic elevation over the past 9 months requiring therapeutic adjustment.',
        readingsCount: 3,
        citationIndex: 1,
      })),
      consultationsAndPlans: [
        {
          id: 'cp-1',
          date: '2026-09-01',
          doctorName: 'Dr. Muhammad Tariq Khan',
          specialty: 'Endocrinology',
          hospital: 'Lady Reading Hospital Peshawar',
          planSummary: 'Initiate dual oral antihyperglycemic therapy and recheck fasting lipids and renal profile in 6 weeks.',
          followUpInstructions: 'Return in 6 weeks with fresh fasting glucose log and serum creatinine.',
          sourceDocumentTitle: 'Consultation Note',
        },
      ],
      treatmentConflicts: [],
      uncertainties: [
        {
          category: 'missing_records',
          detail: 'No comprehensive echocardiogram documented in uploaded records.',
          impact: 'Assess left ventricular function prior to initiating beta-blocker titration.',
        },
      ],
      consultationQuestions: [
        {
          id: 'q-1',
          category: 'treatment_plan',
          question: 'Should the Metformin dose be reduced given borderline renal clearance?',
          rationale: 'Recent serum creatinine trending towards upper limit of normal.',
          relevantDoctor: 'Dr. Muhammad Tariq Khan',
          sourceCitations: ['Prescription 1'],
        },
      ],
      doctorTimeline: Array.from({ length: 8 }, (_, i) => ({
        id: `ev-${i}`,
        date: `2025-0${(i % 9) + 1}-15T00:00:00.000Z`,
        type: 'consultation',
        title: `Comprehensive Outpatient Clinical Evaluation & Treatment Adjustment #${i + 1}`,
        description: 'Detailed clinical assessment including review of laboratory markers and vital signs.',
        doctorName: 'Dr. Muhammad Tariq Khan',
        doctorSpecialty: 'Internal Medicine & Endocrinology',
        hospital: 'Lady Reading Hospital Peshawar Regional Medical Center',
        sourceDocumentId: `doc-${i}`,
        sourceDocumentTitle: `Clinical Note #${i + 1}`,
      })),
      citations: Array.from({ length: 8 }, (_, i) => ({
        index: i + 1,
        documentId: `doc-uuid-${i}`,
        documentTitle: `Detailed Hospital Prescription and Lab Investigation Record with Full Clinical Notes #${i + 1}`,
        documentDate: '15 Jan 2025',
        documentType: 'prescription',
        doctorName: 'Dr. Muhammad Tariq Khan',
        doctorSpecialty: 'Internal Medicine & Endocrinology',
        hospital: 'Lady Reading Hospital Peshawar',
        excerpt: 'Patient advised to strictly comply with prescribed regimen and repeat HbA1c in 3 months. In case of adverse reactions, report immediately to emergency department.',
        doctorAttributionEvidence: 'Stamp and signature on prescription form.',
      })),
      documentCount: 8,
      isPartial: false,
    };

    const pdfBuffer = generateBriefingPdf(longBriefing);
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);

    const pdfContent = pdfBuffer.toString('ascii');
    // Multi-page document should have multiple pages
    expect(pdfContent).toMatch(/\/Count [2-9]/); // At least 2 pages
    // Header should repeat on page > 1
    expect(pdfContent).toContain('Tabeeb Clinical Briefing');
    expect(pdfContent).toContain('Confidential Clinical Record');
    // Footers should include Page X of Y
    expect(pdfContent).toMatch(/Page \d+ of \d+/);
    // All sections should have dynamic section headers
    expect(pdfContent).toContain('1. EXECUTIVE CLINICAL SUMMARY');
    expect(pdfContent).toContain('ATTENDING DOCTORS & CARE TEAM');
    expect(pdfContent.includes('MEDICATION RECORDS & CURRENT-USE VERIFICATION')).toBe(true);
    expect(pdfContent).toContain('RECENT LABORATORY RESULTS');
    expect(pdfContent).toContain('LABORATORY TEST RESULTS & LONGITUDINAL TRENDS');
    expect(pdfContent).toContain('CONSULTATION SUMMARIES & CARE PLANS');
    expect(pdfContent).toContain('DOCUMENTATION GAPS & CLINICAL UNCERTAINTIES');
    expect(pdfContent).toContain('EVIDENCE CITATIONS & SOURCE DOCUMENT PROVENANCE');
    expect(pdfContent).toContain('CLINICAL LEGAL DISCLAIMER');
    expect(pdfContent).toContain('%%EOF');
  });
});

describe('Page Detection & Clinical Document Provenance', () => {
  it('locates entity within multi-page OCR raw text with page markers', () => {
    const rawText = `
--- Page 1 of 3 ---
Hospital Admission Notes
Patient presented with chest pain.
Dr. Tariq Mahmood

--- Page 2 of 3 ---
Prescription Order
Rx Atorvastatin 20mg nocte
Rx Metformin 500mg bd

--- Page 3 of 3 ---
Discharge Instructions
Follow up in 2 weeks.
`;

    expect(findPageNumber(rawText, 'Atorvastatin')).toBe(2);
    expect(findPageNumber(rawText, 'Metformin')).toBe(2);
    expect(findPageNumber(rawText, 'Admission Notes')).toBe(1);
    expect(findPageNumber(rawText, 'Follow up')).toBe(3);
  });

  it('handles various common OCR page header formats', () => {
    const altText = `
[Page 1]
Dr. Sarah Khan
Consultation Note

-- Page 2 --
Diagnosis: Type 2 Diabetes Mellitus
Prescribed Glimepiride 2mg
`;

    expect(findPageNumber(altText, 'Glimepiride')).toBe(2);
    expect(findPageNumber(altText, 'Consultation Note')).toBe(1);
  });

  it('returns null when text does not contain page delimiters without fabricating page numbers', () => {
    const singleScanText = 'Prescription: Dr. Tariq Mahmood. Tab Panadol 500mg tds.';
    expect(findPageNumber(singleScanText, 'Panadol')).toBeNull();
    expect(findPageNumber(undefined, 'Panadol')).toBeNull();
    expect(findPageNumber(singleScanText, 'NonExistentDrug')).toBeNull();
  });
});
