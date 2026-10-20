import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  users,
  documents,
  documentChunks,
  medications, medicationAudit,
  diagnoses,
  labResults,
  allergies,
} from '../../drizzle/schema';
import { getStorage } from '@/lib/storage';
import { getGroq, MODELS } from '@/lib/groq';
import { embeddingProvider } from '@/lib/embeddings';
import { extractText } from '@/services/text-extractors';
import {
  parseStructuredExtraction,
  isExtractionEmpty,
  clamp,
  safeDate,
  type ValidatedExtraction,
} from '@/services/extraction-schema';
import { reconcileExtraction } from '@/services/nlp/reconciler';
import { belongsToPatient } from '@/services/nlp/assertion';
import { linkCondition } from '@/services/nlp/condition-linker';
import { canonicalizeLab } from '@/services/nlp/lab-normalizer';
import { parseMedicalValue, isOutOfRange } from '@/lib/medical-values';
import { generateDocumentSummary } from '@/services/summarizer';
import { estimateTokenCount } from '@/lib/tokens';
import { classifyModelFailure, withModelRetry } from '@/lib/model-errors';
import { prepareMedicationRows, medicationSourceKeys, exactMedicationDate, type PreparedMedicationRow } from '@/services/medications/observations';
import {
  lockMedicationOwner, synchronizeMedicationObservations,
} from '@/services/medications/repository';
import { ApiError, badRequest, notFound } from '@/lib/api-error';

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
      "brandName": "brand only if documented",
      "dosage": "e.g. 500mg",
      "strength": "product strength exactly as written",
      "unit": "strength unit if present",
      "form": "tablet, capsule, extended-release tablet, etc. if present",
      "doseAmount": "amount per administration, e.g. one tablet",
      "frequency": "e.g. twice daily, BD, TDS",
      "duration": "e.g. 7 days",
      "route": "oral, IV, IM, topical, etc.",
      "startDate": "date text exactly as documented, including approximate dates",
      "endDate": "date text exactly as documented",
      "prescriber": "named prescribing clinician only",
      "excerpt": "verbatim source line containing this medicine and directions",
      "instructions": "verbatim medication directions",
      "status": "prescribed_unconfirmed/historical/discontinued/changed/unknown",
      "explicitStop": false,
      "explicitReplacement": "replacement only if source explicitly states it",
      "uncertain": false,
      "durationExpected": false
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
- A prescription does not prove current use. Never infer a medicine was discontinued because it is missing elsewhere. Only use discontinued/changed for explicit source instructions.
- Preserve immediate-release versus extended-release forms; strength and dose amount are different facts.
- Do not supply RxCUIs or infer generic ingredients from model knowledge. Generic and brand names must be explicitly documented.
- Copy excerpt/instructions exactly; never fabricate a quote or page number. Mark unclear medicines uncertain.
- Set durationExpected only when the text explicitly describes a duration or course; not every medicine requires a duration.
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
  // A condition the document denies, attributes to a relative, or raises as advice
  // about what to do if it happens is not this patient's problem, and must never
  // become a row in their record. The reconciler explains each one in the document's
  // notes, and the full extraction is still stored as structured data, so nothing is
  // hidden — it just does not become clinical history.
  const diagnosisRows = data.diagnoses
    .map((d) => {
      const condition = clamp(d.condition, 500);
      if (!condition) return null;

      const assertionStatus = d.assertionStatus ?? 'present';
      if (!belongsToPatient(assertionStatus)) return null;

      // The linked concept's name is stored alongside the verbatim reading so the
      // vault can filter by disease: "DM type II" and "T2DM" must select the same
      // records. The document the patient uploaded still shows its own wording.
      const link = linkCondition(condition);

      return {
        documentId,
        userId,
        condition,
        canonicalCondition: clamp(link?.concept.canonical ?? condition, 500),
        icd10Code: clamp(d.icd10Code ?? link?.concept.icd10, 50),
        severity: clamp(d.severity, 100),
        notes: d.notes ?? null,
        assertionStatus,
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

      // "No known drug allergies" is on virtually every discharge summary, and reading
      // it as an allergy to drugs is the inverse of a safety feature.
      const assertionStatus = a.assertionStatus ?? 'present';
      if (!belongsToPatient(assertionStatus)) return null;

      return {
        documentId,
        userId,
        allergen,
        allergyType: clamp(a.allergyType, 100),
        severity: clamp(a.severity, 100),
        reaction: a.reaction ?? null,
        assertionStatus,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return { diagnosisRows, labResultRows, allergyRows };
}

/** External lookups finish before entering the source replacement transaction. */
async function prepareChunkRows(documentId: string, userId: string, chunks: DocumentChunk[]) {
  if (chunks.length === 0) return [];
  const embeddings = await embeddingProvider.embedBatch(chunks.map((chunk) => chunk.content), 'passage');
  return chunks.map((chunk, index) => ({
    documentId, userId, chunkIndex: index, content: chunk.content,
    embedding: embeddings[index], tokenCount: chunk.tokenCount, section: chunk.section,
  }));
}

type DerivedDataOptions = {
  insertEntities: boolean;
  medicationRows: PreparedMedicationRow[];
  chunks: Awaited<ReturnType<typeof prepareChunkRows>>;
  documentUpdates: Partial<typeof documents.$inferInsert>;
  expectedUpdatedAt?: Date | null;
  processingToken?: Date;
  medicationConfirmations?: Array<{ sourceKey: string; corrections: Record<string, string | null> }>;
};

/** A failed embedding or transaction leaves the previous complete extraction intact. */
async function rebuildDerivedData(
  documentId: string,
  userId: string,
  data: ValidatedExtraction,
  fallbackDate: Date,
  options: DerivedDataOptions
): Promise<void> {
  const { diagnosisRows, labResultRows, allergyRows } = buildEntityRows(documentId, userId, data, fallbackDate);
  await getDb().transaction(async (tx) => {
    await lockMedicationOwner(tx, userId);
    const [current] = await tx.select().from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId))).for('update').limit(1);
    if (!current) throw notFound('Document not found');
    if (options.processingToken && current.processingStartedAt?.getTime() !== options.processingToken.getTime()) {
      throw new ApiError(409, 'The document changed during processing. Refresh and retry.');
    }
    if (options.expectedUpdatedAt && current.updatedAt?.getTime() !== options.expectedUpdatedAt.getTime()) {
      throw new ApiError(409, 'The document changed during confirmation. Refresh and retry.');
    }
    await tx.delete(documentChunks).where(and(eq(documentChunks.documentId, documentId), eq(documentChunks.userId, userId)));
    // An uncertain new OCR pass must not erase established allergy/clinical facts.
    // Replace them only once extraction is sufficiently reliable or confirmed.
    if (options.insertEntities) {
      await tx.delete(diagnoses).where(and(eq(diagnoses.documentId, documentId), eq(diagnoses.userId, userId)));
      await tx.delete(labResults).where(and(eq(labResults.documentId, documentId), eq(labResults.userId, userId)));
      await tx.delete(allergies).where(and(eq(allergies.documentId, documentId), eq(allergies.userId, userId)));
    }
    await synchronizeMedicationObservations(tx, userId, documentId, options.medicationRows, {
      preserveOriginals: options.medicationConfirmations !== undefined,
    });
    for (const confirmation of options.medicationConfirmations ?? []) {
      const [record] = await tx.select().from(medications).where(and(
        eq(medications.documentId, documentId), eq(medications.userId, userId), eq(medications.sourceKey, confirmation.sourceKey)
      )).limit(1);
      if (!record) continue;
      const corrections = { ...record.corrections, ...confirmation.corrections };
      await tx.update(medications).set({ corrections, confirmedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(medications.id, record.id), eq(medications.userId, userId)));
      await tx.insert(medicationAudit).values({
        userId, medicationId: record.id,
        action: Object.keys(confirmation.corrections).length ? 'patient_correction' : 'extraction_confirmed',
        before: { corrections: record.corrections }, after: { corrections },
        note: 'Patient reviewed extraction. This does not confirm current medication use.',
      });
    }
    if (options.insertEntities) {
      if (diagnosisRows.length) await tx.insert(diagnoses).values(diagnosisRows);
      if (labResultRows.length) await tx.insert(labResults).values(labResultRows);
      if (allergyRows.length) await tx.insert(allergies).values(allergyRows);
    }
    if (options.chunks.length) await tx.insert(documentChunks).values(options.chunks);
    await tx.update(documents).set(options.documentUpdates)
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
  });
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
    throw notFound('Document not found');
  }
  return doc;
}

export async function processDocument(documentId: string, userId: string): Promise<void> {
  const doc = await loadOwnedDocument(documentId, userId);
  const processingToken = new Date();
  try {
    await getDb().update(documents).set({
      extractionStatus: 'processing', processingStartedAt: processingToken, updatedAt: processingToken,
    }).where(and(eq(documents.id, documentId), eq(documents.userId, userId)));

    const buffer = await getStorage().read(doc.storagePath);
    const extraction = await extractText(buffer, doc.mimeType);
    const text = extraction.text.trim();
    const confidence = extraction.confidence ?? null;
    if (!text) {
      await getDb().update(documents).set({
        extractionStatus: 'needs_review',
        extractionNotes: 'No readable text could be extracted. Previous observations were retained; verify the original source.',
        processingStartedAt: null, updatedAt: new Date(),
      }).where(and(eq(documents.id, documentId), eq(documents.userId, userId), eq(documents.processingStartedAt, processingToken)));
      return;
    }

    const raw = await extractStructuredData(text, doc.documentType);
    // The medication engine uses exact, validated terminology separately. Never
    // feed approximate legacy RxCUIs into verified medication identity.
    const reconciliation = await reconcileExtraction(text, raw, { skipDrugNormalization: true });
    const structured = reconciliation.extraction;
    const documentDate = exactMedicationDate(structured.documentDate) ?? doc.documentDate;
    const lowConfidence = confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD;
    const notes = [...reconciliation.notes];
    if (lowConfidence) notes.push(`OCR confidence was low (${confidence}%). Medication observations require verification; other entities await confirmation.`);
    if (isExtractionEmpty(structured)) notes.push('No medical entities were identified. Review the source document.');
    if (extraction.isHandwritten) notes.push('Handwritten content detected. Verify medicine names and numbers against the original.');

    const chunks = chunkDocument(text, {
      documentType: doc.documentType,
      hospital: structured.hospital ?? doc.hospital ?? undefined,
      date: documentDate?.toISOString().slice(0, 10),
    });
    const preferredLanguage = await getPreferredLanguage(userId);
    const [medicationRows, chunkRows, summary] = await Promise.all([
      prepareMedicationRows({ documentId, userId, data: structured, text, documentDate, lowConfidence }),
      prepareChunkRows(documentId, userId, chunks),
      generateDocumentSummary({
        text, extraction: structured, documentType: doc.documentType,
        language: structured.language ?? doc.language ?? 'mixed',
        preferredLanguage,
        isHandwritten: extraction.isHandwritten ?? doc.isHandwritten ?? false, confidence,
      }),
    ]);
    await rebuildDerivedData(documentId, userId, structured, documentDate ?? new Date(), {
      insertEntities: !lowConfidence, medicationRows, chunks: chunkRows, processingToken,
      documentUpdates: {
        rawExtractedText: text, structuredData: structured as unknown as Record<string, unknown>,
        hospital: clamp(structured.hospital, 500) ?? doc.hospital,
        doctorName: clamp(structured.doctorName, 255) ?? doc.doctorName,
        documentDate, language: structured.language ?? doc.language,
        isHandwritten: extraction.isHandwritten ?? doc.isHandwritten,
        isScannedPdf: extraction.isScanned ?? doc.isScannedPdf,
        extractionConfidence: confidence, summary,
        extractionStatus: lowConfidence || isExtractionEmpty(structured) ? 'needs_review' : 'confirmed',
        extractionNotes: notes.length ? notes.join(' ') : null,
        processingStartedAt: null, updatedAt: new Date(),
      },
    });
  } catch (error) {
    const failure = classifyModelFailure(error);
    await getDb().update(documents).set({
      extractionStatus: failure.kind === 'permanent' ? 'failed' : 'pending',
      extractionNotes: failure.userMessage, processingStartedAt: null, updatedAt: new Date(),
    }).where(and(eq(documents.id, documentId), eq(documents.userId, userId), eq(documents.processingStartedAt, processingToken)));
    // Model errors can contain source text; logs carry only an operational category.
    console.error(`[DocumentProcessor] processing failed (${failure.kind})`);
    throw error;
  }
}

/** Map review edits to separate patient fields, preserving source medication values. */
export function extractionMedicationCorrections(
  original: ValidatedExtraction['medications'], edited: ValidatedExtraction['medications']
): Array<{ index: number; corrections: Record<string, string | null> }> {
  if (original.length !== edited.length) {
    throw badRequest('Medication additions/removals require source reprocessing. Correct existing medication details in the medication dashboard.');
  }
  const fields = ['name', 'dosage', 'frequency', 'duration', 'route', 'strength', 'doseAmount', 'instructions'] as const;
  const used = new Set<number>();
  const matched = new Map<number, number>();
  // Reserve unchanged observations first, across the entire array. This makes
  // reordered same-name strengths a no-op instead of exchanging their corrections.
  original.forEach((before, index) => {
    const exact = edited.findIndex((after, candidate) =>
      !used.has(candidate) && fields.every((field) => (before[field] ?? null) === (after[field] ?? null))
    );
    if (exact >= 0) {
      matched.set(index, exact);
      used.add(exact);
    }
  });
  return original.map((before, index) => {
    let candidate = matched.get(index);
    if (candidate === undefined) {
      const sameName = edited.flatMap((after, candidate) =>
        !used.has(candidate) && after.name === before.name ? [candidate] : []
      );
      const unmatchedOriginals = original.filter((entry, originalIndex) =>
        !matched.has(originalIndex) && entry.name === before.name
      );
      if (sameName.length > 1 || unmatchedOriginals.length > 1) {
        throw badRequest('Ambiguous medication correction. Correct each medication separately in the medication dashboard.');
      }
      candidate = sameName[0] ?? index;
      if (used.has(candidate)) throw badRequest('Ambiguous medication correction. Correct each medication separately in the medication dashboard.');
      used.add(candidate);
      matched.set(index, candidate);
    }
    const after = edited[candidate];
    const corrections: Record<string, string | null> = {};
    for (const field of fields) {
      if ((before[field] ?? null) !== (after[field] ?? null)) corrections[field] = clamp(after[field], field === 'instructions' ? 2000 : 500);
    }
    return { index, corrections };
  });
}

/** Confirmation and all derived changes commit together, after external work succeeds. */
export async function applyConfirmedExtraction(
  documentId: string,
  userId: string,
  edits: { correctedText?: string; structuredData?: unknown } = {}
): Promise<void> {
  const doc = await loadOwnedDocument(documentId, userId);
  if (doc.extractionStatus === 'processing') throw new ApiError(409, 'Wait for document processing to finish before confirming.');
  const original = parseStructuredExtraction(doc.structuredData);
  const edited = edits.structuredData === undefined ? original : parseStructuredExtraction(edits.structuredData);
  const corrections = extractionMedicationCorrections(original.medications, edited.medications);
  // Medication originals stay in structuredData too. Corrections live on their own
  // records and in audit history, not disguised as text from the uploaded file.
  const structured = { ...edited, medications: original.medications };
  const text = (edits.correctedText ?? doc.rawExtractedText ?? '').trim();
  const preferredLanguage = await getPreferredLanguage(userId);
  const [rows, chunkRows, summary] = await Promise.all([
    prepareMedicationRows({
      documentId, userId, data: original, text: doc.rawExtractedText ?? '',
      documentDate: doc.documentDate, lowConfidence: (doc.extractionConfidence ?? 100) < LOW_CONFIDENCE_THRESHOLD,
    }),
    prepareChunkRows(documentId, userId, chunkDocument(text, {
      documentType: doc.documentType, hospital: doc.hospital ?? undefined,
      date: doc.documentDate?.toISOString().slice(0, 10),
    })),
    generateDocumentSummary({
      text, extraction: structured, documentType: doc.documentType,
      language: structured.language ?? doc.language ?? 'mixed',
      preferredLanguage,
      isHandwritten: doc.isHandwritten ?? false, confidence: doc.extractionConfidence,
    }),
  ]);
  const keys = medicationSourceKeys(original.medications);
  await rebuildDerivedData(documentId, userId, structured, doc.documentDate ?? new Date(), {
    insertEntities: true, medicationRows: rows, chunks: chunkRows, expectedUpdatedAt: doc.updatedAt,
    medicationConfirmations: corrections.map((entry) => ({ sourceKey: keys[entry.index], corrections: entry.corrections })),
    documentUpdates: {
      rawExtractedText: text, structuredData: structured as unknown as Record<string, unknown>,
      summary, extractionStatus: 'confirmed', extractionNotes: null,
      processingStartedAt: null, updatedAt: new Date(),
    },
  });
}
