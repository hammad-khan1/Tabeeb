import type { PatientBriefingData } from './types';

interface PdfLine {
  text: string;
  font: 'F1' | 'F2' | 'F3'; // F1 = Helvetica, F2 = Helvetica-Bold, F3 = Helvetica-Oblique
  size: number;
  r?: number;
  g?: number;
  b?: number;
  indent?: number;
  spaceAfter?: number;
}

function escapePdfString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, ' '); // Keep standard printable ASCII
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if (currentLine.length + word.length + 1 <= maxCharsPerLine) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

export function generateBriefingPdf(briefing: PatientBriefingData): Buffer {
  const allLines: PdfLine[] = [];

  const addHeading = (title: string) => {
    allLines.push({ text: title, font: 'F2', size: 14, r: 0.1, g: 0.25, b: 0.5, spaceAfter: 6 });
  };

  const addParagraph = (text: string, indent = 0) => {
    const wrapped = wrapText(text, 80 - Math.floor(indent / 6));
    for (const line of wrapped) {
      allLines.push({ text: line, font: 'F1', size: 9, r: 0.15, g: 0.15, b: 0.15, indent, spaceAfter: 2 });
    }
    allLines.push({ text: '', font: 'F1', size: 4, spaceAfter: 4 });
  };

  const addBullet = (title: string, desc?: string | null, indent = 12) => {
    const full = desc ? `${title}: ${desc}` : title;
    const wrapped = wrapText(`• ${full}`, 78);
    for (let i = 0; i < wrapped.length; i++) {
      allLines.push({
        text: wrapped[i],
        font: i === 0 && desc ? 'F2' : 'F1',
        size: 9,
        r: 0.15,
        g: 0.15,
        b: 0.15,
        indent: i === 0 ? indent : indent + 8,
        spaceAfter: 2,
      });
    }
  };

  // 1. Header Banner
  allLines.push({ text: 'TABEEB HEALTH COMPANION', font: 'F2', size: 18, r: 0.08, g: 0.4, b: 0.4, spaceAfter: 4 });
  allLines.push({ text: 'Doctor-Ready Patient Briefing & Treatment Attribution', font: 'F2', size: 12, r: 0.3, g: 0.3, b: 0.3, spaceAfter: 8 });
  
  const genDate = new Date(briefing.generatedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const dateRangeStr = briefing.dateRange.isCoveredAllTime
    ? 'All Available Records'
    : `${briefing.dateRange.from ?? 'Start'} to ${briefing.dateRange.to ?? 'Present'}`;

  allLines.push({ text: `Report Generated: ${genDate} | Covered Range: ${dateRangeStr}`, font: 'F3', size: 8, r: 0.4, g: 0.4, b: 0.4, spaceAfter: 12 });

  // 2. Patient Overview
  addHeading('1. Patient Profile');
  addParagraph(`Name: ${briefing.patient.name || 'Patient'}   |   Record ID: ${briefing.patient.id.slice(0, 12)}   |   Documents Reviewed: ${briefing.documentCount}`);
  addParagraph(`Summary: ${briefing.clinicalSummary}`);

  // 3. Documented Conditions
  addHeading('2. Documented Medical Conditions & Diagnoses');
  if (briefing.conditions.length === 0) {
    addParagraph('No conditions documented in selected records.');
  } else {
    for (const c of briefing.conditions) {
      const details = [
        c.icd10Code ? `ICD-10: ${c.icd10Code}` : null,
        c.severity ? `Severity: ${c.severity}` : null,
        c.diagnosingDoctor ? `Diagnosed by: ${c.diagnosingDoctor}` : null,
        `Source: ${c.sourceDocumentTitle}`,
      ].filter(Boolean).join(' | ');
      addBullet(c.condition, details);
    }
  }
  allLines.push({ text: '', font: 'F1', size: 4, spaceAfter: 6 });

  // 4. Doctors Involved in Care
  addHeading('3. Healthcare Professionals Involved in Care');
  if (briefing.doctors.length === 0) {
    addParagraph('No attending doctors identified in uploaded records.');
  } else {
    for (const doc of briefing.doctors) {
      const parts = [
        doc.specialty ? `Specialty: ${doc.specialty}` : null,
        doc.hospital ? `Hospital: ${doc.hospital}` : null,
        doc.contactInfo ? `Contact: ${doc.contactInfo}` : null,
        `Status: ${doc.sourceType.toUpperCase()}${doc.isVerified ? ' (VERIFIED)' : ''}`,
      ].filter(Boolean).join(' | ');
      addBullet(`Dr. ${doc.name}`, parts);
    }
  }
  allLines.push({ text: '', font: 'F1', size: 4, spaceAfter: 6 });

  // 5. Current Medications & Prescribing Doctors
  addHeading('4. Current Medications & Prescribing Attribution');
  if (briefing.currentMedications.length === 0) {
    addParagraph('No active medications documented in selected records.');
  } else {
    for (const med of briefing.currentMedications) {
      const instructions = [med.dosage, med.frequency, med.route].filter(Boolean).join(', ');
      const attr = `Prescribing Doctor: ${med.prescribingDoctor.name}${med.prescribingDoctor.specialty ? ` (${med.prescribingDoctor.specialty})` : ''} | Facility: ${med.hospital || 'Not noted'} | Source: ${med.sourceCitation}`;
      addBullet(`${med.name}${med.genericName ? ` (${med.genericName})` : ''}`, `${instructions || 'Instructions not detailed'} -- [${attr}]`);
    }
  }
  allLines.push({ text: '', font: 'F1', size: 4, spaceAfter: 6 });

  // 6. Historical & Discontinued Medications
  if (briefing.historicalMedications.length > 0) {
    addHeading('5. Historical & Discontinued Medications');
    for (const med of briefing.historicalMedications) {
      const statusLabel = med.status === 'discontinued' ? 'DISCONTINUED' : 'HISTORICAL COURSE';
      addBullet(`${med.name} [${statusLabel}]`, `Prescribed by: ${med.prescribingDoctor.name} | ${med.sourceCitation}`);
    }
    allLines.push({ text: '', font: 'F1', size: 4, spaceAfter: 6 });
  }

  // 7. Known Allergies
  addHeading('6. Documented Allergies & Sensitivities');
  if (briefing.allergies.length === 0) {
    addParagraph('No known allergies recorded in available documents.');
  } else {
    for (const a of briefing.allergies) {
      const details = [a.allergyType, a.severity ? `Severity: ${a.severity}` : null, a.reaction ? `Reaction: ${a.reaction}` : null].filter(Boolean).join(' | ');
      addBullet(a.allergen, details || 'Documented allergy');
    }
  }
  allLines.push({ text: '', font: 'F1', size: 4, spaceAfter: 6 });

  // 8. Laboratory Results & Trends
  addHeading('7. Recent Laboratory Tests & Analyte Trends');
  if (briefing.labTrends.length === 0) {
    addParagraph('No laboratory test results recorded in selected records.');
  } else {
    for (const trend of briefing.labTrends) {
      const flag = trend.latestIsAbnormal ? ' [ABNORMAL]' : '';
      const trendText = trend.readingsCount > 1
        ? `Trend: ${trend.direction.toUpperCase()} (Previous: ${trend.previousValue || 'N/A'}, Latest: ${trend.latestValue} ${trend.unit || ''})`
        : `Value: ${trend.latestValue} ${trend.unit || ''} (Ref: ${trend.referenceRange || 'N/A'})`;
      addBullet(`${trend.testName}${flag}`, `${trendText} -- ${trend.clinicalNote}`);
    }
  }
  allLines.push({ text: '', font: 'F1', size: 4, spaceAfter: 6 });

  // 9. Potential Treatment Conflicts & Discrepancies
  if (briefing.treatmentConflicts.length > 0) {
    addHeading('8. Potential Treatment Conflicts Flagged for Review');
    for (const conf of briefing.treatmentConflicts) {
      addBullet(`[${conf.severity.toUpperCase()}] ${conf.title}`, `${conf.description} Recommendation: ${conf.recommendation}`);
    }
    allLines.push({ text: '', font: 'F1', size: 4, spaceAfter: 6 });
  }

  // 10. Missing / Uncertain Information
  if (briefing.uncertainties.length > 0) {
    addHeading('9. Missing, Uncertain, or Outdated Information');
    for (const u of briefing.uncertainties.slice(0, 5)) {
      addBullet(u.detail, `Clinical impact: ${u.impact}`);
    }
    allLines.push({ text: '', font: 'F1', size: 4, spaceAfter: 6 });
  }

  // 11. Consultation Questions
  addHeading('10. Suggested Questions for Doctor Consultation');
  if (briefing.consultationQuestions.length === 0) {
    addParagraph('No specific medication conflicts or abnormal trends detected requiring tailored questions.');
  } else {
    for (const q of briefing.consultationQuestions) {
      addBullet(`Q: ${q.question}`, `Rationale: ${q.rationale}`);
    }
  }
  allLines.push({ text: '', font: 'F1', size: 4, spaceAfter: 6 });

  // 12. Doctor-wise Timeline
  addHeading('11. Doctor & Clinical Event Timeline');
  if (briefing.doctorTimeline.length === 0) {
    addParagraph('No chronological events found.');
  } else {
    for (const ev of briefing.doctorTimeline.slice(0, 15)) {
      const d = new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      addBullet(`${d} - ${ev.title}`, `Attending: ${ev.doctorName}${ev.doctorSpecialty ? ` (${ev.doctorSpecialty})` : ''} | ${ev.description}`);
    }
  }
  allLines.push({ text: '', font: 'F1', size: 4, spaceAfter: 6 });

  // 13. Citations & Provenance
  addHeading('12. Source Document Citations & Legal Disclaimer');
  addParagraph('Citations: ' + briefing.citations.slice(0, 10).map((c) => `${c.documentTitle} (${c.documentDate || 'N/D'})`).join('; '));
  addParagraph('Notice: Generated by Tabeeb AI Health Companion. This summary is intended to assist doctor-patient consultation and does not replace professional clinical judgment. Verify all medicines and lab values against original printed records.');

  // --- Compile PDF Streams with Page Splitting ---
  const PAGE_HEIGHT = 792; // 11 in @ 72 dpi
  const TOP_MARGIN = 40;
  const BOTTOM_MARGIN = 40;
  const LEFT_MARGIN = 45;

  const pages: string[] = [];
  let currentPageCommands: string[] = [];
  let currentY = PAGE_HEIGHT - TOP_MARGIN;

  for (const line of allLines) {
    const lineHeight = line.size + 4 + (line.spaceAfter ?? 0);
    if (currentY - lineHeight < BOTTOM_MARGIN) {
      // Flush current page
      pages.push(currentPageCommands.join('\n'));
      currentPageCommands = [];
      currentY = PAGE_HEIGHT - TOP_MARGIN;
    }

    const r = (line.r ?? 0).toFixed(2);
    const g = (line.g ?? 0).toFixed(2);
    const b = (line.b ?? 0).toFixed(2);
    const x = LEFT_MARGIN + (line.indent ?? 0);

    if (line.text.trim()) {
      currentPageCommands.push(
        `BT\n${r} ${g} ${b} rg\n/${line.font} ${line.size} Tf\n1 0 0 1 ${x} ${currentY} Tm\n(${escapePdfString(line.text)}) Tj\nET`
      );
    }

    currentY -= lineHeight;
  }

  if (currentPageCommands.length > 0) {
    pages.push(currentPageCommands.join('\n'));
  }

  if (pages.length === 0) {
    pages.push(`BT\n/F1 12 Tf\n1 0 0 1 50 700 Tm\n(Tabeeb Patient Briefing) Tj\nET`);
  }

  // Build PDF document objects
  // 1: Catalog
  // 2: Outlines
  // 3: Pages
  // 4, 5, 6: Font objects
  // For each page: Page object + Content Stream object
  const totalPages = pages.length;
  const objects: string[] = [];

  // Object 1: Catalog
  objects[1] = `<< /Type /Catalog /Pages 3 0 R >>`;
  // Object 2: Outlines
  objects[2] = `<< /Type /Outlines /Count 0 >>`;

  // Object 4: Font F1 (Helvetica)
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  // Object 5: Font F2 (Helvetica-Bold)
  objects[5] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;
  // Object 6: Font F3 (Helvetica-Oblique)
  objects[6] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>`;

  const pageObjectRefs: string[] = [];
  let nextObjId = 7;

  for (let i = 0; i < totalPages; i++) {
    const pageObjId = nextObjId++;
    const contentObjId = nextObjId++;
    pageObjectRefs.push(`${pageObjId} 0 R`);

    const streamContent = pages[i];
    const streamLength = Buffer.byteLength(streamContent, 'ascii');

    objects[pageObjId] = `<< /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> >>`;
    objects[contentObjId] = `<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream`;
  }

  // Object 3: Pages object
  objects[3] = `<< /Type /Pages /Count ${totalPages} /Kids [${pageObjectRefs.join(' ')}] >>`;

  // Assemble full PDF with xref
  let pdf = `%PDF-1.4\n%\xE2\xE3\xCF\xD3\n`;
  const offsets: number[] = [0];

  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'ascii');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;

  for (let i = 1; i < objects.length; i++) {
    const offStr = String(offsets[i]).padStart(10, '0');
    pdf += `${offStr} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'ascii');
}
