import type { PatientBriefingData } from './types';

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const COLORS = {
  navy: { r: 0.05, g: 0.14, b: 0.28 },       // #0c2340 - Deep Medical Navy
  navyDark: { r: 0.03, g: 0.09, b: 0.18 },   // #08172e
  teal: { r: 0.05, g: 0.58, b: 0.53 },       // #0d9488 - Restrained Teal Accent
  tealLight: { r: 0.91, g: 0.97, b: 0.96 },  // #e6f7f5 - Light Teal Tint
  darkText: { r: 0.12, g: 0.16, b: 0.23 },   // #1e293b - Slate Charcoal Text
  mutedText: { r: 0.40, g: 0.46, b: 0.54 },  // #64748b - Muted Gray Text
  lightBg: { r: 0.97, g: 0.98, b: 0.99 },    // #f8fafc - Cool Gray Background
  altRowBg: { r: 0.94, g: 0.96, b: 0.98 },   // #f1f5f9 - Alternate Row Tint
  border: { r: 0.88, g: 0.91, b: 0.94 },     // #e2e8f0 - Border Rule
  borderDark: { r: 0.75, g: 0.80, b: 0.85 }, // #cbd5e1 - Stronger Border
  white: { r: 1.0, g: 1.0, b: 1.0 },
  alertRedBg: { r: 0.99, g: 0.93, b: 0.93 }, // #fee2e2
  alertRedText: { r: 0.73, g: 0.11, b: 0.11 }, // #b91c1c
  alertAmberBg: { r: 1.0, g: 0.97, b: 0.88 }, // #fef3c7
  alertAmberText: { r: 0.71, g: 0.33, b: 0.04 }, // #b45309
  greenText: { r: 0.05, g: 0.47, b: 0.27 }, // #059669
};

function escapePdfString(str: string): string {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, ' '); // Standard ASCII printable
}

/**
 * Robust word-wrapping that splits on whitespace and forces hard breaks
 * on words that exceed maxChars to prevent horizontal overflow.
 */
function wrapText(text: string, maxChars: number): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;

    // Handle words that are longer than the entire line width
    if (word.length > maxChars) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }
      let remaining = word;
      while (remaining.length > maxChars) {
        lines.push(remaining.slice(0, maxChars));
        remaining = remaining.slice(maxChars);
      }
      currentLine = remaining;
      continue;
    }

    if (!currentLine) {
      currentLine = word;
    } else if (currentLine.length + word.length + 1 <= maxChars) {
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

/**
 * Calculates character capacity for a column given width and font size.
 */
function wrapCellText(text: string, colWidth: number, fontSize: number, isBold = false): string[] {
  if (!text) return [];
  const charWidth = fontSize * (isBold ? 0.58 : 0.52);
  const padding = 10; // 5pt left + 5pt right
  const maxChars = Math.max(1, Math.floor((colWidth - padding) / charWidth));
  return wrapText(text, maxChars);
}

class PdfPageContext {
  public commands: string[] = [];
  public currentY: number;
  public pageIndex: number;
  public readonly pageHeight = 792;
  public readonly pageWidth = 612;
  public readonly topMargin = 42;
  public readonly bottomMargin = 44;
  public readonly leftMargin = 40;
  public readonly contentWidth = 532;

  constructor(pageIndex: number) {
    this.pageIndex = pageIndex;
    this.currentY = this.pageHeight - this.topMargin;
  }

  get availableHeight(): number {
    return this.currentY - this.bottomMargin;
  }

  drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    fill?: RgbColor,
    stroke?: RgbColor,
    lineWidth = 0.5
  ) {
    let cmd = 'q\n';
    if (fill) {
      cmd += `${fill.r.toFixed(3)} ${fill.g.toFixed(3)} ${fill.b.toFixed(3)} rg\n`;
    }
    if (stroke) {
      cmd += `${stroke.r.toFixed(3)} ${stroke.g.toFixed(3)} ${stroke.b.toFixed(3)} RG\n`;
      cmd += `${lineWidth.toFixed(2)} w\n`;
    }
    cmd += `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re\n`;
    if (fill && stroke) {
      cmd += 'B\n';
    } else if (fill) {
      cmd += 'f\n';
    } else if (stroke) {
      cmd += 'S\n';
    }
    cmd += 'Q';
    this.commands.push(cmd);
  }

  drawLine(x1: number, y1: number, x2: number, y2: number, color = COLORS.border, width = 0.5) {
    const cmd = `q\n${color.r.toFixed(3)} ${color.g.toFixed(3)} ${color.b.toFixed(3)} RG\n${width.toFixed(2)} w\n${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\nQ`;
    this.commands.push(cmd);
  }

  drawText(
    text: string,
    x: number,
    y: number,
    font: 'F1' | 'F2' | 'F3',
    size: number,
    color: RgbColor = COLORS.darkText
  ) {
    const escaped = escapePdfString(text);
    if (!escaped.trim()) return;
    const cmd = `BT\n${color.r.toFixed(3)} ${color.g.toFixed(3)} ${color.b.toFixed(3)} rg\n/${font} ${size} Tf\n1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm\n(${escaped}) Tj\nET`;
    this.commands.push(cmd);
  }
}

interface TableColumnDef {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

interface TableCellContent {
  text: string;
  subText?: string;
  font?: 'F1' | 'F2' | 'F3';
  subFont?: 'F1' | 'F2' | 'F3';
  fontSize?: number;
  subFontSize?: number;
  color?: RgbColor;
  subColor?: RgbColor;
}

export function generateBriefingPdf(briefing: PatientBriefingData): Buffer {
  const pages: PdfPageContext[] = [];
  const contentWidth = 532;
  const leftMargin = 40;

  let activeTableHeaderRenderer: (() => void) | null = null;

  const startNewPage = (): PdfPageContext => {
    const p = new PdfPageContext(pages.length + 1);
    pages.push(p);

    // If page > 1, draw running header
    if (pages.length > 1) {
      const patientName = briefing.patient.name || 'Patient';
      p.drawText(`Tabeeb Clinical Briefing  ·  ${patientName}`, leftMargin, 762, 'F2', 8, COLORS.mutedText);
      p.drawText(`Confidential Clinical Record`, leftMargin + contentWidth - 110, 762, 'F3', 8, COLORS.mutedText);
      p.drawLine(leftMargin, 752, leftMargin + contentWidth, 752, COLORS.border, 0.5);
      p.currentY = 736;

      // Repeat active table header if we split across pages
      if (activeTableHeaderRenderer) {
        activeTableHeaderRenderer();
      }
    }
    return p;
  };

  let currentPage = startNewPage();

  const ensureSpace = (height: number): PdfPageContext => {
    if (currentPage.availableHeight < height) {
      currentPage = startNewPage();
    }
    return currentPage;
  };

  // 1. Cover / Top Branded Banner (Page 1)
  currentPage.drawRect(leftMargin, currentPage.currentY - 54, contentWidth, 54, COLORS.navy);
  currentPage.drawRect(leftMargin, currentPage.currentY - 54, 4, 54, COLORS.teal); // Accent left bar
  currentPage.drawText('TABEEB HEALTH COMPANION', leftMargin + 14, currentPage.currentY - 20, 'F2', 13, COLORS.white);
  currentPage.drawText('DOCTOR-READY PATIENT CLINICAL BRIEFING', leftMargin + 14, currentPage.currentY - 36, 'F2', 9, COLORS.teal);
  currentPage.drawText('EVIDENCE-GROUNDED MEDICAL RECORD DIGEST  ·  CONFIDENTIAL', leftMargin + 14, currentPage.currentY - 47, 'F3', 7.5, COLORS.altRowBg);
  currentPage.currentY -= 64;

  // 2. Patient Profile & Report Metadata Card
  const profileCardHeight = 52;
  currentPage.drawRect(leftMargin, currentPage.currentY - profileCardHeight, contentWidth, profileCardHeight, COLORS.lightBg, COLORS.border, 0.75);

  const genDateStr = new Date(briefing.generatedAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const dateRangeStr = briefing.dateRange.isCoveredAllTime
    ? 'All Available Records'
    : `${briefing.dateRange.from ?? 'Start'} to ${briefing.dateRange.to ?? 'Present'}`;

  // Col 1: Patient
  currentPage.drawText('PATIENT NAME', leftMargin + 12, currentPage.currentY - 16, 'F2', 7, COLORS.mutedText);
  currentPage.drawText(briefing.patient.name || 'Verified Patient', leftMargin + 12, currentPage.currentY - 30, 'F2', 10, COLORS.navy);
  currentPage.drawText(`ID: ${briefing.patient.id.slice(0, 16)}`, leftMargin + 12, currentPage.currentY - 42, 'F1', 7.5, COLORS.mutedText);

  // Col 2: Date Range
  currentPage.drawText('RECORD TIMELINE', leftMargin + 170, currentPage.currentY - 16, 'F2', 7, COLORS.mutedText);
  currentPage.drawText(dateRangeStr, leftMargin + 170, currentPage.currentY - 30, 'F2', 9, COLORS.darkText);
  currentPage.drawText(`Covering ${briefing.documentCount} clinical document(s)`, leftMargin + 170, currentPage.currentY - 42, 'F1', 7.5, COLORS.mutedText);

  // Col 3: Report Metadata
  currentPage.drawText('REPORT GENERATED', leftMargin + 370, currentPage.currentY - 16, 'F2', 7, COLORS.mutedText);
  currentPage.drawText(genDateStr, leftMargin + 370, currentPage.currentY - 30, 'F2', 9, COLORS.darkText);
  currentPage.drawText('Prepared for clinical review', leftMargin + 370, currentPage.currentY - 42, 'F3', 7.5, COLORS.teal);

  currentPage.currentY -= profileCardHeight + 14;

  // --- Dynamic Section Counter & Section Heading Helper ---
  let sectionCounter = 1;

  const drawSectionHeading = (title: string, count?: number, minRequiredSpace = 75) => {
    // Orphan heading prevention: Ensure space for heading + at least 1 table header & 1 data row
    ensureSpace(minRequiredSpace);
    const num = sectionCounter++;
    const countBadge = count !== undefined ? ` (${count})` : '';
    const headingText = `${num}. ${title}${countBadge}`;

    currentPage.drawRect(leftMargin, currentPage.currentY - 20, contentWidth, 20, COLORS.altRowBg, COLORS.border, 0.5);
    currentPage.drawRect(leftMargin, currentPage.currentY - 20, 3.5, 20, COLORS.teal);
    currentPage.drawText(headingText.toUpperCase(), leftMargin + 10, currentPage.currentY - 14, 'F2', 8.5, COLORS.navy);
    currentPage.currentY -= 26;
  };

  /**
   * Universal, robust table rendering engine that handles:
   * - Automatic text line wrapping per column width
   * - Dynamic row heights based on wrapped line count
   * - Multi-page table splits with repeated column headers on subsequent pages
   * - Alternate row background shading and borders
   */
  const renderTable = (
    columns: TableColumnDef[],
    rows: TableCellContent[][],
    emptyMessage: string
  ) => {
    if (rows.length === 0) {
      ensureSpace(24);
      currentPage.drawRect(leftMargin, currentPage.currentY - 20, contentWidth, 20, COLORS.lightBg, COLORS.border, 0.4);
      currentPage.drawText(emptyMessage, leftMargin + 12, currentPage.currentY - 13, 'F3', 8, COLORS.mutedText);
      currentPage.currentY -= 28;
      return;
    }

    const drawHeader = () => {
      currentPage.drawRect(leftMargin, currentPage.currentY - 16, contentWidth, 16, COLORS.navy);
      let curX = leftMargin;
      for (const col of columns) {
        currentPage.drawText(col.header, curX + 6, currentPage.currentY - 11, 'F2', 7.5, COLORS.white);
        curX += col.width;
      }
      currentPage.currentY -= 17;
    };

    // Set active header renderer so new pages repeat this table's header
    activeTableHeaderRenderer = drawHeader;
    ensureSpace(38); // Ensure space for header + first row
    drawHeader();

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];

      // 1. Calculate wrapped lines and height for each cell
      const cellLinesList: { lines: string[]; subLines: string[]; fontSize: number; subFontSize: number }[] = [];
      let maxCellHeight = 16;

      for (let c = 0; c < columns.length; c++) {
        const cell = row[c] || { text: '' };
        const colWidth = columns[c].width;
        const fontSize = cell.fontSize || 8;
        const subFontSize = cell.subFontSize || 7;

        const lines = wrapCellText(cell.text, colWidth, fontSize, cell.font === 'F2');
        const subLines = cell.subText ? wrapCellText(cell.subText, colWidth, subFontSize, cell.subFont === 'F2') : [];

        const lineHeight = fontSize + 2.5;
        const subLineHeight = subFontSize + 2;
        const cellH = lines.length * lineHeight + (subLines.length ? subLines.length * subLineHeight + 2 : 0) + 8; // 4pt top & bottom padding

        if (cellH > maxCellHeight) {
          maxCellHeight = cellH;
        }
        cellLinesList.push({ lines, subLines, fontSize, subFontSize });
      }

      // 2. Ensure page space for this row
      ensureSpace(maxCellHeight);

      // 3. Draw row background and border
      const bg = r % 2 === 0 ? COLORS.white : COLORS.lightBg;
      currentPage.drawRect(leftMargin, currentPage.currentY - maxCellHeight, contentWidth, maxCellHeight, bg, COLORS.border, 0.35);

      // 4. Render cell contents
      let colX = leftMargin;
      for (let c = 0; c < columns.length; c++) {
        const cell = row[c] || { text: '' };
        const colWidth = columns[c].width;
        const { lines, subLines, fontSize, subFontSize } = cellLinesList[c];

        let textY = currentPage.currentY - 4 - fontSize; // 4pt padding from top

        // Main text lines
        for (const line of lines) {
          currentPage.drawText(line, colX + 6, textY, cell.font || 'F1', fontSize, cell.color || COLORS.darkText);
          textY -= fontSize + 2.5;
        }

        // Subtitle / Generic lines
        if (subLines.length > 0) {
          textY -= 1;
          for (const sLine of subLines) {
            currentPage.drawText(sLine, colX + 6, textY, cell.subFont || 'F3', subFontSize, cell.subColor || COLORS.mutedText);
            textY -= subFontSize + 2;
          }
        }

        colX += colWidth;
      }

      currentPage.currentY -= maxCellHeight;
    }

    // Clear active table header after table finishes
    activeTableHeaderRenderer = null;
    currentPage.currentY -= 10;
  };

  // =========================================================================
  // Section 1: Executive Clinical Digest
  // =========================================================================
  drawSectionHeading('Executive Clinical Summary', undefined, 60);
  const summaryLines = wrapText(briefing.clinicalSummary, 92);
  const digestBoxHeight = summaryLines.length * 12 + 16;
  ensureSpace(digestBoxHeight + 8);
  currentPage.drawRect(leftMargin, currentPage.currentY - digestBoxHeight, contentWidth, digestBoxHeight, COLORS.tealLight, COLORS.border, 0.5);
  currentPage.drawRect(leftMargin, currentPage.currentY - digestBoxHeight, 3.5, digestBoxHeight, COLORS.teal);
  for (let i = 0; i < summaryLines.length; i++) {
    currentPage.drawText(summaryLines[i], leftMargin + 12, currentPage.currentY - 14 - i * 12, 'F1', 8.5, COLORS.darkText);
  }
  currentPage.currentY -= digestBoxHeight + 14;

  // =========================================================================
  // Section 2: Potential Treatment Conflicts & Discrepancies
  // =========================================================================
  if (briefing.treatmentConflicts.length > 0) {
    drawSectionHeading('Potential Treatment Discrepancies & Duplicate Therapies', briefing.treatmentConflicts.length, 70);
    for (const conflict of briefing.treatmentConflicts) {
      const descLines = wrapText(conflict.description, 86);
      const recLines = wrapText(`Clinical Recommendation: ${conflict.recommendation}`, 86);
      const isHigh = conflict.severity === 'high';
      const boxHeight = (descLines.length + recLines.length) * 11 + 32;

      ensureSpace(boxHeight + 8);
      currentPage.drawRect(
        leftMargin,
        currentPage.currentY - boxHeight,
        contentWidth,
        boxHeight,
        isHigh ? COLORS.alertRedBg : COLORS.alertAmberBg,
        COLORS.border,
        0.5
      );
      currentPage.drawRect(
        leftMargin,
        currentPage.currentY - boxHeight,
        4,
        boxHeight,
        isHigh ? COLORS.alertRedText : COLORS.alertAmberText
      );

      currentPage.drawText(
        `[${conflict.severity.toUpperCase()} PRIORITY]  ${conflict.title}`,
        leftMargin + 12,
        currentPage.currentY - 14,
        'F2',
        8.5,
        isHigh ? COLORS.alertRedText : COLORS.alertAmberText
      );

      let textY = currentPage.currentY - 26;
      for (const line of descLines) {
        currentPage.drawText(line, leftMargin + 12, textY, 'F1', 8, COLORS.darkText);
        textY -= 11;
      }
      textY -= 2;
      for (const line of recLines) {
        currentPage.drawText(line, leftMargin + 12, textY, 'F2', 7.5, isHigh ? COLORS.alertRedText : COLORS.alertAmberText);
        textY -= 11;
      }

      currentPage.currentY -= boxHeight + 8;
    }
  }

  // =========================================================================
  // Section 3: Healthcare Professionals & Care Team
  // =========================================================================
  drawSectionHeading('Attending Doctors & Care Team', briefing.doctors.length);
  const doctorColumns: TableColumnDef[] = [
    { header: 'PHYSICIAN NAME', width: 142 },
    { header: 'SPECIALTY', width: 125 },
    { header: 'HOSPITAL / CLINICAL FACILITY', width: 165 },
    { header: 'STATUS', width: 100 },
  ];
  const doctorRows: TableCellContent[][] = briefing.doctors.map((doc) => [
    {
      text: doc.name.toLowerCase().startsWith('dr') ? doc.name : `Dr. ${doc.name}`,
      font: 'F2',
      fontSize: 8,
      color: COLORS.navy,
      subText: doc.contactInfo || undefined,
      subFont: 'F3',
      subFontSize: 6.5,
    },
    {
      text: doc.specialty || 'General / Not specified',
      font: 'F1',
      fontSize: 7.5,
      color: COLORS.darkText,
    },
    {
      text: doc.hospital || 'Facility not specified',
      font: 'F1',
      fontSize: 7.5,
      color: COLORS.mutedText,
    },
    {
      text: doc.sourceType.toUpperCase(),
      font: 'F2',
      fontSize: 7,
      color: doc.isVerified ? COLORS.greenText : COLORS.teal,
    },
  ]);
  renderTable(doctorColumns, doctorRows, 'No attending healthcare providers identified in records.');

  // =========================================================================
  // Section 4: Current Medications & Prescribing Attribution
  // =========================================================================
  drawSectionHeading('Current Medications & Prescribing Attribution', briefing.currentMedications.length);
  const medColumns: TableColumnDef[] = [
    { header: 'MEDICATION & GENERIC', width: 142 },
    { header: 'DOSAGE & SCHEDULE', width: 125 },
    { header: 'PRESCRIBING DOCTOR', width: 165 },
    { header: 'CITATION', width: 100 },
  ];
  const medRows: TableCellContent[][] = briefing.currentMedications.map((med) => {
    const dosageStr = [med.dosage, med.frequency, med.route].filter(Boolean).join(', ') || 'As directed';
    const citeBadge = med.citationIndex ? `[${med.citationIndex}]` : '[*]';
    const docName = med.prescribingDoctor.name || 'Unattributed Prescriber';
    const docSpec = med.prescribingDoctor.specialty || med.hospital || null;

    return [
      {
        text: med.name,
        subText: med.genericName ? `(${med.genericName})` : undefined,
        font: 'F2',
        fontSize: 8,
        color: COLORS.navy,
      },
      {
        text: dosageStr,
        font: 'F1',
        fontSize: 7.5,
        color: COLORS.darkText,
      },
      {
        text: docName,
        subText: docSpec || undefined,
        font: 'F1',
        fontSize: 7.5,
        color: COLORS.darkText,
      },
      {
        text: citeBadge,
        subText: med.sourceDocumentTitle ? med.sourceDocumentTitle.slice(0, 20) : undefined,
        font: 'F2',
        fontSize: 8,
        color: COLORS.teal,
      },
    ];
  });
  renderTable(medColumns, medRows, 'No active medications documented in available records.');

  // =========================================================================
  // Section 5: Historical & Discontinued Medications
  // =========================================================================
  if (briefing.historicalMedications.length > 0) {
    drawSectionHeading('Historical & Discontinued Medications', briefing.historicalMedications.length);
    const histColumns: TableColumnDef[] = [
      { header: 'MEDICATION', width: 142 },
      { header: 'STATUS & DOSAGE', width: 125 },
      { header: 'PRESCRIBING DOCTOR', width: 165 },
      { header: 'CITATION', width: 100 },
    ];
    const histRows: TableCellContent[][] = briefing.historicalMedications.map((med) => [
      {
        text: med.name,
        subText: med.genericName ? `(${med.genericName})` : undefined,
        font: 'F2',
        fontSize: 8,
        color: COLORS.darkText,
      },
      {
        text: (med.status || 'historical').toUpperCase(),
        subText: med.dosage || undefined,
        font: 'F2',
        fontSize: 7,
        color: med.status === 'discontinued' ? COLORS.alertRedText : COLORS.mutedText,
      },
      {
        text: med.prescribingDoctor.name || 'Prescriber on record',
        subText: med.prescribingDoctor.specialty || undefined,
        font: 'F1',
        fontSize: 7.5,
        color: COLORS.mutedText,
      },
      {
        text: med.citationIndex ? `[${med.citationIndex}]` : '[*]',
        font: 'F2',
        fontSize: 8,
        color: COLORS.teal,
      },
    ]);
    renderTable(histColumns, histRows, 'No historical medications recorded.');
  }

  // =========================================================================
  // Section 6: Documented Conditions & Diagnoses
  // =========================================================================
  drawSectionHeading('Documented Conditions & Diagnoses', briefing.conditions.length);
  const conditionColumns: TableColumnDef[] = [
    { header: 'CLINICAL CONDITION', width: 162 },
    { header: 'ICD-10 & STATUS', width: 110 },
    { header: 'DIAGNOSING DOCTOR / FACILITY', width: 160 },
    { header: 'CITATION', width: 100 },
  ];
  const conditionRows: TableCellContent[][] = briefing.conditions.map((c) => [
    {
      text: c.condition,
      font: 'F2',
      fontSize: 8,
      color: COLORS.navy,
    },
    {
      text: c.icd10Code ? `ICD-10: ${c.icd10Code}` : (c.assertionStatus || 'Diagnosed').toUpperCase(),
      subText: c.severity ? `Severity: ${c.severity}` : undefined,
      font: 'F1',
      fontSize: 7.5,
      color: COLORS.darkText,
    },
    {
      text: c.diagnosingDoctor || 'Attending Physician',
      subText: c.hospital || undefined,
      font: 'F1',
      fontSize: 7.5,
      color: COLORS.mutedText,
    },
    {
      text: c.citationIndex ? `[${c.citationIndex}]` : '[*]',
      font: 'F2',
      fontSize: 8,
      color: COLORS.teal,
    },
  ]);
  renderTable(conditionColumns, conditionRows, 'No clinical diagnoses documented in available records.');

  // =========================================================================
  // Section 7: Documented Allergies & Sensitivities
  // =========================================================================
  drawSectionHeading('Documented Allergies & Sensitivities', briefing.allergies.length);
  const allergyColumns: TableColumnDef[] = [
    { header: 'ALLERGEN', width: 162 },
    { header: 'ALLERGY TYPE', width: 110 },
    { header: 'OBSERVED REACTION & SEVERITY', width: 160 },
    { header: 'CITATION', width: 100 },
  ];
  const allergyRows: TableCellContent[][] = briefing.allergies.map((a) => [
    {
      text: a.allergen,
      font: 'F2',
      fontSize: 8,
      color: COLORS.alertRedText,
    },
    {
      text: a.allergyType || 'Hypersensitivity',
      font: 'F1',
      fontSize: 7.5,
      color: COLORS.darkText,
    },
    {
      text: a.reaction || 'Reaction not specified',
      subText: a.severity ? `Severity: ${a.severity}` : undefined,
      font: 'F1',
      fontSize: 7.5,
      color: COLORS.mutedText,
    },
    {
      text: a.citationIndex ? `[${a.citationIndex}]` : '[*]',
      font: 'F2',
      fontSize: 8,
      color: COLORS.teal,
    },
  ]);
  renderTable(allergyColumns, allergyRows, 'No documented allergies or adverse reactions on file.');

  // =========================================================================
  // Section 8: Recent Laboratory Results (Attributed)
  // =========================================================================
  if (briefing.recentLabResults && briefing.recentLabResults.length > 0) {
    drawSectionHeading('Recent Laboratory Results', briefing.recentLabResults.length);
    const recentLabColumns: TableColumnDef[] = [
      { header: 'TEST / ANALYTE', width: 142 },
      { header: 'OBSERVED VALUE', width: 105 },
      { header: 'REFERENCE RANGE', width: 105 },
      { header: 'ORDERING DOCTOR / FACILITY', width: 110 },
      { header: 'CITATION', width: 70 },
    ];
    const recentLabRows: TableCellContent[][] = briefing.recentLabResults.map((r) => [
      {
        text: r.testName,
        font: 'F2',
        fontSize: 8,
        color: r.isAbnormal ? COLORS.alertRedText : COLORS.navy,
      },
      {
        text: `${r.value} ${r.unit || ''}`.trim(),
        subText: r.isAbnormal ? 'ABNORMAL' : 'NORMAL',
        font: 'F2',
        fontSize: 8,
        color: r.isAbnormal ? COLORS.alertRedText : COLORS.darkText,
        subFont: 'F2',
        subFontSize: 6.5,
        subColor: r.isAbnormal ? COLORS.alertRedText : COLORS.greenText,
      },
      {
        text: r.referenceRange || 'Standard range',
        font: 'F1',
        fontSize: 7.5,
        color: COLORS.mutedText,
      },
      {
        text: r.orderingDoctor.name || 'Lab Physician',
        subText: r.performingFacility || undefined,
        font: 'F1',
        fontSize: 7.5,
        color: COLORS.darkText,
      },
      {
        text: r.citationIndex ? `[${r.citationIndex}]` : '[*]',
        font: 'F2',
        fontSize: 8,
        color: COLORS.teal,
      },
    ]);
    renderTable(recentLabColumns, recentLabRows, 'No recent laboratory tests recorded.');
  }

  // =========================================================================
  // Section 9: Laboratory Test Results & Longitudinal Trends
  // =========================================================================
  drawSectionHeading('Laboratory Test Results & Longitudinal Trends', briefing.labTrends.length);
  const trendColumns: TableColumnDef[] = [
    { header: 'TEST / ANALYTE', width: 142 },
    { header: 'LATEST VALUE', width: 100 },
    { header: 'REFERENCE RANGE', width: 100 },
    { header: 'LONGITUDINAL TRAJECTORY', width: 120 },
    { header: 'CITATION', width: 70 },
  ];
  const trendRows: TableCellContent[][] = briefing.labTrends.map((t) => {
    const isAbnormal = t.latestIsAbnormal;
    const trendText = t.readingsCount > 1
      ? `${t.direction.toUpperCase()} (${t.previousValue || 'N/A'} -> ${t.latestValue})`
      : 'Single reading';

    return [
      {
        text: t.testName,
        font: 'F2',
        fontSize: 8,
        color: isAbnormal ? COLORS.alertRedText : COLORS.navy,
      },
      {
        text: `${t.latestValue} ${t.unit || ''}`.trim(),
        subText: isAbnormal ? 'ABNORMAL' : undefined,
        font: 'F2',
        fontSize: 8,
        color: isAbnormal ? COLORS.alertRedText : COLORS.darkText,
        subFont: 'F2',
        subFontSize: 6.5,
        subColor: COLORS.alertRedText,
      },
      {
        text: t.referenceRange || 'Not specified',
        font: 'F1',
        fontSize: 7.5,
        color: COLORS.mutedText,
      },
      {
        text: trendText,
        subText: t.clinicalNote || undefined,
        font: 'F1',
        fontSize: 7,
        color: isAbnormal ? COLORS.alertRedText : COLORS.teal,
      },
      {
        text: t.citationIndex ? `[${t.citationIndex}]` : '[*]',
        font: 'F2',
        fontSize: 8,
        color: COLORS.teal,
      },
    ];
  });
  renderTable(trendColumns, trendRows, 'No laboratory results documented in selected records.');

  // =========================================================================
  // Section 10: Consultation Summaries & Care Plans
  // =========================================================================
  if (briefing.consultationsAndPlans && briefing.consultationsAndPlans.length > 0) {
    drawSectionHeading('Consultation Summaries & Care Plans', briefing.consultationsAndPlans.length);
    const planColumns: TableColumnDef[] = [
      { header: 'DATE & PROVIDER', width: 142 },
      { header: 'CLINICAL FACILITY', width: 120 },
      { header: 'PLAN SUMMARY & FOLLOW-UP', width: 270 },
    ];
    const planRows: TableCellContent[][] = briefing.consultationsAndPlans.map((cp) => [
      {
        text: cp.doctorName,
        subText: cp.date ? new Date(cp.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : undefined,
        font: 'F2',
        fontSize: 8,
        color: COLORS.navy,
      },
      {
        text: cp.hospital || cp.specialty || 'Clinic',
        font: 'F1',
        fontSize: 7.5,
        color: COLORS.mutedText,
      },
      {
        text: cp.planSummary,
        subText: cp.followUpInstructions ? `Follow-up: ${cp.followUpInstructions}` : undefined,
        font: 'F1',
        fontSize: 7.5,
        color: COLORS.darkText,
      },
    ]);
    renderTable(planColumns, planRows, 'No consultation summaries on file.');
  }

  // =========================================================================
  // Section 11: Documentation Gaps & Clinical Uncertainties
  // =========================================================================
  if (briefing.uncertainties && briefing.uncertainties.length > 0) {
    drawSectionHeading('Documentation Gaps & Clinical Uncertainties', briefing.uncertainties.length);
    const uncColumns: TableColumnDef[] = [
      { header: 'CATEGORY & ISSUE', width: 182 },
      { header: 'CLINICAL IMPACT & MITIGATION', width: 350 },
    ];
    const uncRows: TableCellContent[][] = briefing.uncertainties.map((u) => [
      {
        text: u.category.replace(/_/g, ' ').toUpperCase(),
        subText: u.detail,
        font: 'F2',
        fontSize: 7.5,
        color: COLORS.alertAmberText,
      },
      {
        text: u.impact,
        font: 'F1',
        fontSize: 7.5,
        color: COLORS.darkText,
      },
    ]);
    renderTable(uncColumns, uncRows, 'No record gaps identified.');
  }

  // =========================================================================
  // Section 12: Suggested Questions for Doctor Consultation
  // =========================================================================
  if (briefing.consultationQuestions.length > 0) {
    drawSectionHeading('Suggested Questions for Doctor Consultation', briefing.consultationQuestions.length, 60);
    for (const q of briefing.consultationQuestions) {
      const qLines = wrapText(`“${q.question}”`, 88);
      const rLines = wrapText(`Clinical rationale: ${q.rationale}`, 88);
      const boxHeight = (qLines.length + rLines.length) * 11 + 18;

      ensureSpace(boxHeight + 6);
      currentPage.drawRect(leftMargin, currentPage.currentY - boxHeight, contentWidth, boxHeight, COLORS.lightBg, COLORS.border, 0.4);
      currentPage.drawRect(leftMargin, currentPage.currentY - boxHeight, 3, boxHeight, COLORS.teal);

      let textY = currentPage.currentY - 12;
      for (const line of qLines) {
        currentPage.drawText(line, leftMargin + 10, textY, 'F2', 8, COLORS.navy);
        textY -= 11;
      }
      for (const line of rLines) {
        currentPage.drawText(line, leftMargin + 10, textY, 'F3', 7.5, COLORS.mutedText);
        textY -= 11;
      }

      currentPage.currentY -= boxHeight + 6;
    }
    currentPage.currentY -= 6;
  }

  // =========================================================================
  // Section 13: Chronological Doctor & Event Timeline
  // =========================================================================
  if (briefing.doctorTimeline.length > 0) {
    drawSectionHeading('Chronological Doctor & Care Timeline', briefing.doctorTimeline.length);
    const timeColumns: TableColumnDef[] = [
      { header: 'DATE & TYPE', width: 120 },
      { header: 'CLINICAL EVENT & FINDINGS', width: 232 },
      { header: 'ATTENDING DOCTOR / FACILITY', width: 180 },
    ];
    const timeRows: TableCellContent[][] = briefing.doctorTimeline.slice(0, 15).map((ev) => {
      const d = new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const doctorDisplay = ev.doctorName.toLowerCase().startsWith('dr') ? ev.doctorName : `Dr. ${ev.doctorName}`;

      return [
        {
          text: d,
          subText: ev.type.replace(/_/g, ' ').toUpperCase(),
          font: 'F2',
          fontSize: 8,
          color: COLORS.navy,
        },
        {
          text: ev.title,
          subText: ev.description || undefined,
          font: 'F1',
          fontSize: 7.5,
          color: COLORS.darkText,
        },
        {
          text: doctorDisplay,
          subText: [ev.doctorSpecialty, ev.hospital].filter(Boolean).join(' · ') || undefined,
          font: 'F1',
          fontSize: 7.5,
          color: COLORS.mutedText,
        },
      ];
    });
    renderTable(timeColumns, timeRows, 'No timeline events recorded.');
  }

  // =========================================================================
  // Section 14: Evidence Citations & Source Document Directory
  // =========================================================================
  drawSectionHeading('Evidence Citations & Source Document Provenance', briefing.citations.length, 65);
  for (let idx = 0; idx < briefing.citations.length; idx++) {
    const c = briefing.citations[idx];
    const indexLabel = c.index ?? (idx + 1);
    const pageStr = c.pageNumber ? ` · Page ${c.pageNumber}` : '';
    const titleText = `[${indexLabel}]  ${c.documentTitle} (${c.documentDate || 'Undated'})${pageStr}`;

    const titleLines = wrapText(titleText, 88);
    const excerptPreview = c.excerpt ? c.excerpt.replace(/\s+/g, ' ') : 'Original clinical document on file.';
    const excerptLines = wrapText(`Excerpt: "${excerptPreview}"`, 92);

    const cardHeight = titleLines.length * 11 + excerptLines.length * 10 + 12;
    ensureSpace(cardHeight + 4);

    let cardY = currentPage.currentY - 11;
    for (const tLine of titleLines) {
      currentPage.drawText(tLine, leftMargin + 8, cardY, 'F2', 8, COLORS.navy);
      cardY -= 11;
    }

    cardY -= 1;
    for (const eLine of excerptLines) {
      currentPage.drawText(eLine, leftMargin + 20, cardY, 'F3', 7, COLORS.mutedText);
      cardY -= 10;
    }

    currentPage.currentY -= cardHeight + 4;
  }
  currentPage.currentY -= 8;

  // =========================================================================
  // Section 15: Medical Legal Disclaimer
  // =========================================================================
  ensureSpace(60);
  const disclaimerText = [
    'CLINICAL LEGAL DISCLAIMER & USAGE NOTICE',
    'Generated by Tabeeb AI Health Companion for clinical review and communication assistance.',
    'Extracted information is compiled directly from patient-uploaded medical documents and is not independently',
    'verified by a licensed clinician. Treatment discrepancy flags are automated alerts for doctor consultation.',
    'Decisions regarding diagnosis, prescriptions, or dosages must be confirmed against original clinical records.',
  ];
  currentPage.drawRect(leftMargin, currentPage.currentY - 55, contentWidth, 55, COLORS.lightBg, COLORS.border, 0.5);
  currentPage.drawRect(leftMargin, currentPage.currentY - 55, 3.5, 55, COLORS.mutedText);
  currentPage.drawText(disclaimerText[0], leftMargin + 10, currentPage.currentY - 12, 'F2', 7.5, COLORS.navy);
  currentPage.drawText(disclaimerText[1], leftMargin + 10, currentPage.currentY - 22, 'F1', 7, COLORS.mutedText);
  currentPage.drawText(disclaimerText[2], leftMargin + 10, currentPage.currentY - 31, 'F1', 7, COLORS.mutedText);
  currentPage.drawText(disclaimerText[3], leftMargin + 10, currentPage.currentY - 40, 'F1', 7, COLORS.mutedText);
  currentPage.drawText(disclaimerText[4], leftMargin + 10, currentPage.currentY - 49, 'F1', 7, COLORS.mutedText);
  currentPage.currentY -= 65;

  // --- Final Pass: Append Running Footers with Total Pages ---
  const totalPages = pages.length;
  for (let p = 0; p < totalPages; p++) {
    const page = pages[p];
    page.drawLine(leftMargin, 34, leftMargin + contentWidth, 34, COLORS.border, 0.5);
    page.drawText(
      'Tabeeb 2.0  ·  Doctor-Ready Patient Briefing  ·  Confidential Medical Digest',
      leftMargin,
      22,
      'F1',
      7.5,
      COLORS.mutedText
    );
    page.drawText(
      `Page ${p + 1} of ${totalPages}`,
      leftMargin + contentWidth - 65,
      22,
      'F2',
      7.5,
      COLORS.navy
    );
  }

  // --- Build PDF Document Structures & Cross-Reference Table ---
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

    const streamContent = pages[i].commands.join('\n');
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
