import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  documents,
  documentChunks,
  medications,
  diagnoses,
  labResults,
  allergies,
} from '../../drizzle/schema';
import { localStorage } from '@/lib/storage';
import { groq, MODELS } from '@/lib/groq';
import { embeddingProvider } from '@/lib/embeddings';
import { extractText } from '@/services/text-extractors';
import type { StructuredExtraction } from '@/types/medical';

// ── Section detection patterns ──────────────────────────────────────────────

const SECTION_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /(?:medications?|medicines?|drugs?|prescriptions?|rx)\b/i, name: 'Medications' },
  { pattern: /(?:labs?|laboratory|test results|blood work|pathology|cbc|chemistry)\b/i, name: 'Lab Results' },
  { pattern: /(?:diagnos(?:is|es|tic)|impression|assessment|conditions?)\b/i, name: 'Diagnosis' },
  { pattern: /(?:allerg(?:y|ies)|hypersensitivit)/i, name: 'Allergies' },
  { pattern: /(?:vitals?|blood pressure|temperature|pulse|heart rate)/i, name: 'Vitals' },
  { pattern: /(?:history|anamnesis|chief complaint|presenting)/i, name: 'History' },
  { pattern: /(?:examinations?|physical exam|clinical exam|findings)/i, name: 'Examination' },
  { pattern: /(?:procedures?|surger(?:y|ies)|operations?|interventions?)/i, name: 'Procedures' },
  { pattern: /(?:discharge|summaries?|summary|disposition|follow.?up|plans?)/i, name: 'Discharge Summary' },
  { pattern: /(?:imaging|radiology|x-rays?|ct scans?|mris?|ultrasounds?)/i, name: 'Imaging' },
];

const MAX_CHUNK_CHARS = 3200;

// ── Structured data extraction via LLM ──────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a medical data extraction specialist for a Pakistani healthcare system. Extract structured medical information from the provided text.

The text may contain English, Urdu, or a mix of both. Extract all identifiable medical entities.

Return ONLY valid JSON matching this exact schema:
{
  "medications": [
    {
      "name": "brand or common name",
      "genericName": "generic name if identifiable",
      "dosage": "e.g. 500mg",
      "frequency": "e.g. twice daily, BD, TDS",
      "duration": "e.g. 7 days",
      "route": "oral, IV, IM, topical, etc.",
      "isActive": true
    }
  ],
  "diagnoses": [
    {
      "condition": "diagnosis text",
      "icd10Code": "code if mentioned",
      "severity": "mild/moderate/severe if mentioned",
      "notes": "additional context"
    }
  ],
  "labResults": [
    {
      "testName": "test name",
      "value": "result value as string",
      "numericValue": 123,
      "unit": "mg/dL etc.",
      "referenceRange": "normal range if provided",
      "isAbnormal": false,
      "testDate": "YYYY-MM-DD if available"
    }
  ],
  "allergies": [
    {
      "allergen": "substance",
      "allergyType": "drug/food/environmental",
      "severity": "mild/moderate/severe",
      "reaction": "reaction description"
    }
  ],
  "hospital": "hospital or clinic name if mentioned",
  "doctorName": "attending physician if mentioned",
  "documentDate": "YYYY-MM-DD if identifiable",
  "documentType": "prescription/lab_report/discharge_summary/imaging_report/consultation_note/other",
  "language": "en/ur/mixed"
}

Rules:
- Return empty arrays for categories with no findings, never null
- For lab results, set isAbnormal=true only when explicitly flagged or clearly outside reference range
- Preserve original Urdu text alongside transliteration when present
- Do NOT invent data that is not in the text
- If a date is not found, omit the field rather than guessing`;

export async function extractStructuredData(
  text: string,
  documentType: string
): Promise<StructuredExtraction> {
  const response = await groq.chat.completions.create({
    model: MODELS.primary,
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Document type hint: ${documentType}\n\nExtract all medical entities from the following text:\n\n${text}`,
      },
    ],
    temperature: 0.1,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from extraction model');
  }

  return JSON.parse(content) as StructuredExtraction;
}

// ── Section-aware document chunking ─────────────────────────────────────────

export interface DocumentChunk {
  content: string;
  section: string;
  tokenCount: number;
}

interface ChunkMetadata {
  documentType: string;
  hospital?: string;
  date?: string;
}

function detectSection(text: string): string {
  for (const { pattern, name } of SECTION_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return 'General';
}

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildContextHeader(
  meta: ChunkMetadata,
  section: string
): string {
  const parts = [`Document: ${meta.documentType}`];
  if (meta.hospital) parts.push(`Hospital: ${meta.hospital}`);
  if (meta.date) parts.push(`Date: ${meta.date}`);
  parts.push(`Section: ${section}`);
  return `[${parts.join(', ')}]`;
}

export function chunkDocument(
  text: string,
  metadata: ChunkMetadata
): DocumentChunk[] {
  if (!text.trim()) return [];

  const lines = text.split('\n');
  const chunks: DocumentChunk[] = [];
  let currentSection = 'General';
  let currentText = '';

  for (const line of lines) {
    const sectionMatch = detectSection(line);
    if (sectionMatch !== 'General' && sectionMatch !== currentSection) {
      if (currentText.trim()) {
        const header = buildContextHeader(metadata, currentSection);
        const fullContent = `${header}\n${currentText.trim()}`;
        if (fullContent.length > MAX_CHUNK_CHARS) {
          const subChunks = splitIntoSubChunks(fullContent, MAX_CHUNK_CHARS);
          for (const sub of subChunks) {
            chunks.push({
              content: sub,
              section: currentSection,
              tokenCount: estimateTokenCount(sub),
            });
          }
        } else {
          chunks.push({
            content: fullContent,
            section: currentSection,
            tokenCount: estimateTokenCount(fullContent),
          });
        }
      }
      currentSection = sectionMatch;
      currentText = line + '\n';
    } else {
      currentText += line + '\n';
    }
  }

  if (currentText.trim()) {
    const header = buildContextHeader(metadata, currentSection);
    const fullContent = `${header}\n${currentText.trim()}`;
    if (fullContent.length > MAX_CHUNK_CHARS) {
      const subChunks = splitIntoSubChunks(fullContent, MAX_CHUNK_CHARS);
      for (const sub of subChunks) {
        chunks.push({
          content: sub,
          section: currentSection,
          tokenCount: estimateTokenCount(sub),
        });
      }
    } else {
      chunks.push({
        content: fullContent,
        section: currentSection,
        tokenCount: estimateTokenCount(fullContent),
      });
    }
  }

  return chunks;
}

function splitIntoSubChunks(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current) {
      chunks.push(current.trim());
      current = '';
    }
    if (para.length > maxChars) {
      if (current) {
        chunks.push(current.trim());
        current = '';
      }
      let start = 0;
      while (start < para.length) {
        const end = Math.min(start + maxChars, para.length);
        const slice = para.slice(start, end);
        const breakPoint = slice.lastIndexOf('. ');
        if (breakPoint > maxChars * 0.5) {
          chunks.push(slice.slice(0, breakPoint + 1).trim());
          start = start + breakPoint + 1;
        } else {
          chunks.push(slice.trim());
          start = end;
        }
      }
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

// ── Insert extracted entities into normalized tables ────────────────────────

async function insertExtractedEntities(
  documentId: string,
  userId: string,
  data: StructuredExtraction
): Promise<void> {
  const safeDate = (val: unknown): Date | null => {
    if (!val) return null;
    const d = new Date(String(val));
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const medicationRows = data.medications.map((m) => ({
    documentId,
    userId,
    name: m.name,
    genericName: m.genericName ?? null,
    dosage: m.dosage ?? null,
    frequency: m.frequency ?? null,
    duration: m.duration ?? null,
    route: m.route ?? null,
    rxnormId: m.rxnormId ?? null,
    isActive: m.isActive ?? true,
    prescribedDate: safeDate(m.prescribedDate),
  }));

  const diagnosisRows = data.diagnoses.map((d) => ({
    documentId,
    userId,
    condition: d.condition,
    icd10Code: d.icd10Code ?? null,
    severity: d.severity ?? null,
    notes: d.notes ?? null,
    diagnosedDate: safeDate(d.diagnosedDate),
  }));

  const labResultRows = data.labResults.map((l) => {
    let numVal: number | null = null;
    if (l.numericValue != null) {
      const parsed = Number(String(l.numericValue).replace(/,/g, ''));
      numVal = Number.isFinite(parsed) ? Math.round(parsed) : null;
    }
    return {
      documentId,
      userId,
      testName: l.testName,
      value: String(l.value),
      numericValue: numVal,
      unit: l.unit ?? null,
      referenceRange: l.referenceRange ?? null,
      isAbnormal: l.isAbnormal ?? false,
      testDate: safeDate(l.testDate) ?? new Date(),
    };
  });

  const allergyRows = data.allergies.map((a) => ({
    documentId,
    userId,
    allergen: a.allergen,
    allergyType: a.allergyType ?? null,
    severity: a.severity ?? null,
    reaction: a.reaction ?? null,
  }));

  const inserts: Promise<unknown>[] = [];
  if (medicationRows.length > 0) inserts.push(getDb().insert(medications).values(medicationRows));
  if (diagnosisRows.length > 0) inserts.push(getDb().insert(diagnoses).values(diagnosisRows));
  if (labResultRows.length > 0) inserts.push(getDb().insert(labResults).values(labResultRows));
  if (allergyRows.length > 0) inserts.push(getDb().insert(allergies).values(allergyRows));

  await Promise.all(inserts);
}

// ── Generate embeddings and store chunks ─────────────────────────────────────

async function embedAndStoreChunks(
  documentId: string,
  userId: string,
  chunks: DocumentChunk[]
): Promise<void> {
  if (chunks.length === 0) return;

  const texts = chunks.map((c) => c.content);
  const embeddings = await embeddingProvider.embedBatch(texts);

  const rows = chunks.map((chunk, i) => ({
    documentId,
    userId,
    chunkIndex: i,
    content: chunk.content,
    embedding: embeddings[i],
    tokenCount: chunk.tokenCount,
    section: chunk.section,
  }));

  await getDb().insert(documentChunks).values(rows);
}

// ── Main orchestrator ───────────────────────────────────────────────────────

export async function processDocument(
  documentId: string,
  userId: string
): Promise<void> {
  const [doc] = await getDb()    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    throw new Error(`Document not found: ${documentId}`);
  }

  try {
    await getDb()      .update(documents)
      .set({ extractionStatus: 'processing', updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    const buffer = await localStorage.read(doc.storagePath);

    const extraction = await extractText(buffer, doc.mimeType);

    if (extraction.isScanned) {
      await getDb()        .update(documents)
        .set({
          extractionStatus: 'needs_review',
          isScannedPdf: true,
          extractionNotes: 'Scanned PDF detected — image-based OCR required',
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));
      return;
    }

    const text = extraction.text;

    await getDb()      .update(documents)
      .set({
        rawExtractedText: text,
        isHandwritten: extraction.isHandwritten ?? doc.isHandwritten,
        extractionConfidence: extraction.confidence ?? null,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    const structured = await extractStructuredData(text, doc.documentType);

    await getDb()      .update(documents)
      .set({
        structuredData: structured as unknown as Record<string, unknown>,
        hospital: structured.hospital ?? doc.hospital,
        doctorName: structured.doctorName ?? doc.doctorName,
        documentDate: structured.documentDate
          ? new Date(structured.documentDate)
          : doc.documentDate,
        language: structured.language ?? doc.language,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    await insertExtractedEntities(documentId, userId, structured);

    const chunks = chunkDocument(text, {
      documentType: doc.documentType,
      hospital: structured.hospital ?? doc.hospital ?? undefined,
      date: structured.documentDate ?? (doc.documentDate?.toISOString() ?? undefined),
    });

    await embedAndStoreChunks(documentId, userId, chunks);

    await getDb()      .update(documents)
      .set({ extractionStatus: 'confirmed', updatedAt: new Date() })
      .where(eq(documents.id, documentId));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await getDb()      .update(documents)
      .set({
        extractionStatus: 'failed',
        extractionNotes: `Processing failed: ${message}`,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
    throw error;
  }
}
