import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  users,
  documents,
  documentChunks,
  medications,
  diagnoses,
  labResults,
  allergies,
  imagingFindings,
} from '../../drizzle/schema';
import { localStorage } from '@/lib/storage';
import { getGroq, MODELS } from '@/lib/groq';
import { embeddingProvider } from '@/lib/embeddings';
import { extractText } from '@/services/text-extractors';
import { buildImagingNote } from '@/services/radiology/validator';
import {
  parseStructuredExtraction,
  isExtractionEmpty,
  clamp,
  safeDate,
  type ValidatedExtraction,
} from '@/services/extraction-schema';
import { reconcileExtraction } from '@/services/nlp/reconciler';
import { canonicalizeLab } from '@/services/nlp/lab-normalizer';
import { parseMedicalValue, isOutOfRange } from '@/lib/medical-values';
import { generateDocumentSummary } from '@/services/summarizer';
import { estimateTokenCount } from '@/lib/tokens';
import { classifyModelFailure, withModelRetry } from '@/lib/model-errors';

// Re-exported for callers that already import it from here.
export { estimateTokenCount };

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

/**
 * multilingual-e5-large truncates silently past ~512 tokens, so chunks are budgeted in
 * estimated tokens rather than characters — Urdu script is far denser per character.
 */
const MAX_CHUNK_TOKENS = 450;

/** Below this OCR confidence, entities are held back from the health record for review. */
const LOW_CONFIDENCE_THRESHOLD = 45;

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
      "numericValue": 123.4,
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
- Preserve decimal precision exactly as written — numericValue for "HbA1c 6.8 %" is 6.8, not 7
- For lab results, set isAbnormal=true only when explicitly flagged or clearly outside reference range
- Preserve original Urdu text alongside transliteration when present
- Do NOT invent data that is not in the text
- If a date is not found, omit the field rather than guessing
- The text may come from OCR of a handwritten form and can contain [unclear: ...] markers. Extract the entity anyway and keep the marker inside the relevant field so the patient can verify it. Never substitute a guess for an unclear drug name or number.
- Expand clinical shorthand into the correct field: OD/BD/BID/TDS/TID/QID/HS/SOS/PRN belong in "frequency", PO/IV/IM/SC belong in "route", and Tab/Cap/Syp/Inj describe the dosage form`;

export async function extractStructuredData(
  text: string,
  documentType: string
): Promise<ValidatedExtraction> {
  const response = await withModelRetry(
    () => getGroq().chat.completions.create({
    model: MODELS.primary,
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Document type hint: ${documentType}\n\nExtract all medical entities from the following text:\n\n${text}`,
      },
    ],
    temperature: 0.1,
    max_tokens: 8192,
    response_format: { type: 'json_object' },
    }),
    { label: 'Extraction' }
  );

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from extraction model');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error('Extraction model returned malformed JSON');
  }

  return parseStructuredExtraction(raw);
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

function buildContextHeader(meta: ChunkMetadata, section: string): string {
  const parts = [`Document: ${meta.documentType}`];
  if (meta.hospital) parts.push(`Hospital: ${meta.hospital}`);
  if (meta.date) parts.push(`Date: ${meta.date}`);
  parts.push(`Section: ${section}`);
  return `[${parts.join(', ')}]`;
}

function groupIntoSections(text: string): Array<{ section: string; body: string }> {
  const lines = text.split('\n');
  const groups: Array<{ section: string; lines: string[] }> = [];
  let current = { section: 'General', lines: [] as string[] };

  for (const line of lines) {
    const detected = detectSection(line);
    if (detected !== 'General' && detected !== current.section) {
      if (current.lines.some((l) => l.trim())) groups.push(current);
      current = { section: detected, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.trim())) groups.push(current);

  return groups.map((group) => ({
    section: group.section,
    body: group.lines.join('\n').trim(),
  }));
}

function sliceByEstimatedTokens(text: string, maxTokens: number): string[] {
  const density = estimateTokenCount(text) / text.length;
  const charBudget = Math.max(200, Math.floor(maxTokens / density));
  const pieces: string[] = [];
  for (let start = 0; start < text.length; start += charBudget) {
    pieces.push(text.slice(start, start + charBudget).trim());
  }
  return pieces.filter(Boolean);
}

function splitOversizedLine(line: string, maxTokens: number): string[] {
  // '۔' is the Urdu full stop.
  const sentences = line.split(/(?<=[.!?۔])\s+/);
  const pieces: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (estimateTokenCount(sentence) > maxTokens) {
      if (current) {
        pieces.push(current);
        current = '';
      }
      pieces.push(...sliceByEstimatedTokens(sentence, maxTokens));
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (estimateTokenCount(candidate) > maxTokens) {
      if (current) pieces.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

function splitByTokenBudget(body: string, maxTokens: number): string[] {
  const lines = body.split('\n').filter((line) => line.trim().length > 0);
  const pieces: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length > 0) {
      pieces.push(current.join('\n'));
      current = [];
    }
  };

  for (const line of lines) {
    if (estimateTokenCount(line) > maxTokens) {
      flush();
      pieces.push(...splitOversizedLine(line, maxTokens));
      continue;
    }

    const candidate = [...current, line].join('\n');
    if (estimateTokenCount(candidate) > maxTokens) {
      flush();
      current = [line];
    } else {
      current.push(line);
    }
  }

  flush();
  return pieces;
}

export function chunkDocument(text: string, metadata: ChunkMetadata): DocumentChunk[] {
  if (!text.trim()) return [];

  const chunks: DocumentChunk[] = [];

  for (const { section, body } of groupIntoSections(text)) {
    const header = buildContextHeader(metadata, section);
    // Every sub-chunk repeats the header, so the body budget excludes it.
    const bodyBudget = Math.max(50, MAX_CHUNK_TOKENS - estimateTokenCount(header));

    for (const piece of splitByTokenBudget(body, bodyBudget)) {
      const content = `${header}\n${piece}`;
      chunks.push({ content, section, tokenCount: estimateTokenCount(content) });
    }
  }

  return chunks;
}

// ── Insert extracted entities into normalized tables ────────────────────────

function buildEntityRows(
  documentId: string,
  userId: string,
  data: ValidatedExtraction,
  fallbackDate: Date
) {
  const medicationRows = data.medications
    .map((m) => {
      const name = clamp(m.name, 500);
      if (!name) return null;
      return {
        documentId,
        userId,
        name,
        genericName: clamp(m.genericName, 500),
        dosage: clamp(m.dosage, 255),
        frequency: clamp(m.frequency, 255),
        duration: clamp(m.duration, 255),
        route: clamp(m.route, 100),
        rxnormId: clamp(m.rxnormId, 50),
        isActive: m.isActive ?? true,
        prescribedDate: safeDate(m.prescribedDate),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const diagnosisRows = data.diagnoses
    .map((d) => {
      const condition = clamp(d.condition, 500);
      if (!condition) return null;
      return {
        documentId,
        userId,
        condition,
        icd10Code: clamp(d.icd10Code, 50),
        severity: clamp(d.severity, 100),
        notes: d.notes ?? null,
        diagnosedDate: safeDate(d.diagnosedDate),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const labResultRows = data.labResults
    .map((l) => {
      const testName = clamp(l.testName, 500);
      if (!testName) return null;

      const rawValue = l.value ?? (l.numericValue != null ? String(l.numericValue) : undefined);
      const value = clamp(rawValue, 100);
      if (!value) return null;

      // Parse the printed string first: it carries digit grouping and censoring that
      // the model's numericValue has usually already lost.
      const numericValue =
        parseMedicalValue(l.value)?.value ?? parseMedicalValue(l.numericValue)?.value ?? null;

      const canonical = canonicalizeLab(testName, numericValue, l.unit ?? null);
      const derivedAbnormal = isOutOfRange(numericValue, l.referenceRange ?? null);

      return {
        documentId,
        userId,
        testName,
        canonicalTestName: canonical.canonicalTestName,
        canonicalValue: canonical.canonicalValue,
        canonicalUnit: clamp(canonical.canonicalUnit ?? undefined, 50),
        value,
        numericValue,
        unit: clamp(l.unit, 100),
        referenceRange: clamp(l.referenceRange, 255),
        isAbnormal: l.isAbnormal ?? derivedAbnormal ?? false,
        testDate: safeDate(l.testDate) ?? fallbackDate,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const allergyRows = data.allergies
    .map((a) => {
      const allergen = clamp(a.allergen, 500);
      if (!allergen) return null;
      return {
        documentId,
        userId,
        allergen,
        allergyType: clamp(a.allergyType, 100),
        severity: clamp(a.severity, 100),
        reaction: a.reaction ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return { medicationRows, diagnosisRows, labResultRows, allergyRows };
}

/**
 * Clearing derived rows and writing the new ones is a single transaction. These were
 * separate statement batches, so a failure between them — an embedding timeout was
 * the likely one — left the document stripped of its medications, labs and chunks
 * with nothing to rebuild them from. Reprocessing a working document could destroy it.
 */
async function rebuildDerivedData(
  documentId: string,
  userId: string,
  data: ValidatedExtraction,
  fallbackDate: Date,
  options: {
    includeImaging: boolean;
    insertEntities: boolean;
    imagingRows: Array<typeof imagingFindings.$inferInsert>;
  }
): Promise<void> {
  const { medicationRows, diagnosisRows, labResultRows, allergyRows } = buildEntityRows(
    documentId,
    userId,
    data,
    fallbackDate
  );

  await getDb().transaction(async (tx) => {
    await tx.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
    await tx.delete(medications).where(eq(medications.documentId, documentId));
    await tx.delete(diagnoses).where(eq(diagnoses.documentId, documentId));
    await tx.delete(labResults).where(eq(labResults.documentId, documentId));
    await tx.delete(allergies).where(eq(allergies.documentId, documentId));

    if (options.includeImaging) {
      await tx.delete(imagingFindings).where(eq(imagingFindings.documentId, documentId));
    }

    if (options.imagingRows.length > 0) {
      await tx.insert(imagingFindings).values(options.imagingRows);
    }

    if (!options.insertEntities) return;

    if (medicationRows.length > 0) await tx.insert(medications).values(medicationRows);
    if (diagnosisRows.length > 0) await tx.insert(diagnoses).values(diagnosisRows);
    if (labResultRows.length > 0) await tx.insert(labResults).values(labResultRows);
    if (allergyRows.length > 0) await tx.insert(allergies).values(allergyRows);
  });
}

// ── Generate embeddings and store chunks ─────────────────────────────────────

async function embedAndStoreChunks(
  documentId: string,
  userId: string,
  chunks: DocumentChunk[]
): Promise<void> {
  if (chunks.length === 0) return;

  const texts = chunks.map((c) => c.content);
  const embeddings = await embeddingProvider.embedBatch(texts, 'passage');

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

/**
 * Loads the document, asserting ownership. Both entry points used to select by id
 * alone and then write every derived row with whatever `userId` they were handed —
 * safe only because all three callers happened to check first.
 */
/** The patient's interface language, which the summary is written in. */
async function getPreferredLanguage(userId: string): Promise<'en' | 'ur' | 'mixed' | null> {
  const [row] = await getDb()
    .select({ preferredLanguage: users.preferredLanguage })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.preferredLanguage ?? null;
}

async function loadOwnedDocument(documentId: string, userId: string) {
  const [doc] = await getDb()
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);

  if (!doc) {
    throw new Error(`Document not found: ${documentId}`);
  }
  return doc;
}

export async function processDocument(documentId: string, userId: string): Promise<void> {
  const doc = await loadOwnedDocument(documentId, userId);

  try {
    await getDb()
      .update(documents)
      .set({
        extractionStatus: 'processing',
        processingStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    // Derived rows are deliberately NOT cleared here. They are replaced in one
    // transaction once the new set is ready, so a failure part-way leaves the
    // previous good extraction in place rather than an empty record.
    const buffer = await localStorage.read(doc.storagePath);
    const extraction = await extractText(buffer, doc.mimeType, doc.documentType);
    const text = extraction.text.trim();
    const confidence = extraction.confidence ?? null;

    if (!text) {
      await getDb()
        .update(documents)
        .set({
          extractionStatus: 'needs_review',
          isScannedPdf: extraction.isScanned ?? doc.isScannedPdf,
          rawExtractedText: '',
          extractionConfidence: confidence,
          extractionNotes:
            'No readable text could be extracted from this file. Try uploading a sharper photo or scan.',
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));
      return;
    }

    await getDb()
      .update(documents)
      .set({
        rawExtractedText: text,
        isHandwritten: extraction.isHandwritten ?? doc.isHandwritten,
        isScannedPdf: extraction.isScanned ?? doc.isScannedPdf,
        extractionConfidence: confidence,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    const raw = await extractStructuredData(text, doc.documentType);
    const reconciliation = await reconcileExtraction(text, raw);
    const structured = reconciliation.extraction;
    const documentDate = safeDate(structured.documentDate) ?? doc.documentDate;

    await getDb()
      .update(documents)
      .set({
        structuredData: structured as unknown as Record<string, unknown>,
        hospital: clamp(structured.hospital, 500) ?? doc.hospital,
        doctorName: clamp(structured.doctorName, 255) ?? doc.doctorName,
        documentDate,
        language: structured.language ?? doc.language,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    const notes: string[] = [...reconciliation.notes];
    const lowConfidence = confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD;

    if (lowConfidence) {
      notes.push(
        `OCR confidence was low (${confidence}%). Medications and lab values were not added to your health record yet — review the extracted text and confirm to save them.`
      );
    }

    // Findings come from the chest X-ray classifier, already validated and worded by
    // services/radiology/validator — the vision LLM no longer produces any of them.
    const imagingRows = (extraction.radiologyFindings ?? []).map((f) => ({
      documentId,
      userId,
      bodyPart: clamp(f.bodyPart, 200) ?? 'chest',
      modality: doc.documentType === 'imaging_report' ? 'x-ray' : null,
      finding: f.finding,
      location: clamp(f.location ?? undefined, 300),
      severity: clamp(f.severity, 100),
      description: f.description,
      aiConfidence: Math.round(f.confidence),
      urgencyLevel: f.urgencyLevel,
      validationNotes: f.validationNotes,
      validated: f.validated,
    }));

    // What the model did and did not check is stated on the document either way —
    // silence must never read to a patient as "your X-ray is clear".
    if (extraction.classification) {
      notes.push(buildImagingNote(extraction.classification));
    }

    // One transaction swaps the old derived rows for the new ones.
    await rebuildDerivedData(documentId, userId, structured, documentDate ?? new Date(), {
      includeImaging: true,
      insertEntities: !lowConfidence,
      imagingRows,
    });

    const chunks = chunkDocument(text, {
      documentType: doc.documentType,
      hospital: structured.hospital ?? doc.hospital ?? undefined,
      date: documentDate?.toISOString().slice(0, 10),
    });

    await embedAndStoreChunks(documentId, userId, chunks);

    if (isExtractionEmpty(structured)) {
      notes.push('No medical entities were identified in this document — please review the extracted text.');
    }
    if (extraction.isHandwritten) {
      notes.push('Handwritten content detected — please verify drug names and numbers against the original.');
    }

    const needsReview = lowConfidence || isExtractionEmpty(structured);

    const summary = await generateDocumentSummary({
      text,
      extraction: structured,
      documentType: doc.documentType,
      language: structured.language ?? doc.language ?? 'mixed',
      preferredLanguage: await getPreferredLanguage(userId),
      isHandwritten: extraction.isHandwritten ?? doc.isHandwritten ?? false,
      confidence,
    });

    await getDb()
      .update(documents)
      .set({
        summary,
        extractionStatus: needsReview ? 'needs_review' : 'confirmed',
        extractionNotes: notes.length > 0 ? notes.join(' ') : null,
        processingStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
  } catch (error) {
    const failure = classifyModelFailure(error);

    // A document that could not be processed because the AI service was rate limited
    // is not a bad document. Telling the patient to "re-upload a clearer scan" for a
    // quota error sends them off to re-photograph something that was fine, so the
    // status and the message now reflect which of the two actually happened.
    await getDb()
      .update(documents)
      .set({
        extractionStatus: failure.kind === 'permanent' ? 'failed' : 'pending',
        extractionNotes: failure.userMessage,
        processingStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    console.error(`[DocumentProcessor] ${documentId} (${failure.kind}): ${failure.detail}`);
    throw error;
  }
}

/**
 * Applies text/entity corrections the user confirmed in the review UI: entities held
 * back during low-confidence extraction are written now, and chunks are re-embedded
 * so the corrected text is what RAG actually searches.
 */
export async function applyConfirmedExtraction(
  documentId: string,
  userId: string
): Promise<void> {
  const doc = await loadOwnedDocument(documentId, userId);

  const structured = parseStructuredExtraction(doc.structuredData);
  const text = (doc.rawExtractedText ?? '').trim();

  await rebuildDerivedData(documentId, userId, structured, doc.documentDate ?? new Date(), {
    // Imaging findings come from the vision pass, not from the confirmed text, so
    // they are left alone here.
    includeImaging: false,
    insertEntities: true,
    imagingRows: [],
  });

  if (!text) return;

  const chunks = chunkDocument(text, {
    documentType: doc.documentType,
    hospital: doc.hospital ?? undefined,
    date: doc.documentDate?.toISOString().slice(0, 10),
  });
  await embedAndStoreChunks(documentId, userId, chunks);

  const summary = await generateDocumentSummary({
    text,
    extraction: structured,
    documentType: doc.documentType,
    language: structured.language ?? doc.language ?? 'mixed',
    preferredLanguage: await getPreferredLanguage(userId),
    isHandwritten: doc.isHandwritten ?? false,
    confidence: doc.extractionConfidence,
  });

  if (summary) {
    await getDb()
      .update(documents)
      .set({ summary, updatedAt: new Date() })
      .where(eq(documents.id, documentId));
  }
}
