import { describe, it, expect } from 'vitest';
import {
  normalizeDoctorName,
  detectSpecialty,
  extractContactInfo,
  buildDoctorProfiles,
  attributePrescription,
  attributeLabResult,
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
    expect(pdfString).toContain('%%EOF');
  });
});
