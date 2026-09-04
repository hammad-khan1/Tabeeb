import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getGroq, MODELS } from '@/lib/groq';
import { estimateTokenCount } from '@/lib/tokens';
import {
  documents,
  medications,
  diagnoses,
  labResults,
  allergies,
  healthInsights,
} from '../../../drizzle/schema';

interface HealthFinding {
  category: string;
  title: string;
  detail: string;
  priority: 'info' | 'attention' | 'action_needed';
}

interface HealthDigestResult {
  id: string;
  title: string;
  digest: string;
  findings: HealthFinding[];
  documentIdsReviewed: string[];
  priority: string;
  generatedAt: Date;
}

/**
 * The model's JSON was cast to the interface and written straight to the database, so
 * a missing `findings` array or an out-of-range `priority` reached Postgres unchecked.
 */
const digestSchema = z.object({
  title: z.string().trim().min(1).max(500).catch('Health insight digest'),
  digest: z.string().trim().min(1).max(20_000).catch('No summary generated.'),
  findings: z
    .array(
      z.object({
        category: z.enum(['medications', 'labs', 'diagnoses', 'allergies', 'general']).catch('general'),
        title: z.string().trim().min(1).max(300),
        detail: z.string().trim().max(4000).catch(''),
        priority: z.enum(['info', 'attention', 'action_needed']).catch('info'),
      })
    )
    .max(50)
    .catch([]),
  priority: z.enum(['normal', 'elevated', 'urgent']).optional().catch(undefined),
});

const DIGEST_SYSTEM_PROMPT = `You are a medical analyst AI reviewing a patient's complete health record. Analyze the provided data and generate actionable health insights.

Return JSON with this exact structure:
{
  "title": "Brief summary title of overall health status",
  "digest": "2-3 paragraph comprehensive health summary in plain language",
  "findings": [
    {
      "category": "medications|labs|diagnoses|allergies|general",
      "title": "Short finding title",
      "detail": "Detailed explanation of the finding and what it means",
      "priority": "info|attention|action_needed"
    }
  ],
  "priority": "normal|elevated|urgent"
}

Guidelines:
- Focus on patterns, trends, and interactions across all data
- Flag any abnormal lab values or medication conflicts
- Note any missing follow-ups or gaps in care
- Be conservative: recommend doctor consultation for anything uncertain
- Do NOT fabricate findings not supported by the data`;

/**
 * Caps on what goes into the digest prompt.
 *
 * None of these queries had a limit: the whole record — every document, medication,
 * diagnosis, lab result and allergy — was formatted into a single prompt. This is the
 * most token-expensive call in the app, and on a patient with a few years of history
 * it would silently exceed the context window and be truncated mid-record rather than
 * failing cleanly.
 *
 * The bias is toward recency, because a digest is about the patient's current state.
 * Allergies are capped highest and never filtered by date — an old allergy is still
 * an allergy.
 */
const LIMITS = {
  documents: 40,
  medications: 40,
  diagnoses: 30,
  labResults: 60,
  allergies: 50,
} as const;

/** Leaves room for the system prompt and a 4096-token response. */
const MAX_SUMMARY_TOKENS = 8000;

function capToTokenBudget(text: string, maxTokens: number): string {
  if (estimateTokenCount(text) <= maxTokens) return text;

  // Drop whole lines from the end so a record entry is never cut in half.
  const lines = text.split('\n');
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const cost = estimateTokenCount(line);
    if (used + cost > maxTokens) break;
    kept.push(line);
    used += cost;
  }
  kept.push('', '(Older entries omitted to stay within the review limit.)');
  return kept.join('\n');
}

async function fetchPatientData(userId: string) {
  const [docRows, medRows, diagRows, labRows, allergyRows] = await Promise.all([
    getDb()
      .select({
        id: documents.id,
        title: documents.title,
        documentType: documents.documentType,
        documentDate: documents.documentDate,
        hospital: documents.hospital,
      })
      .from(documents)
      .where(eq(documents.userId, userId))
      .orderBy(desc(documents.documentDate), desc(documents.createdAt))
      .limit(LIMITS.documents),
    // Active medicines first: an inactive one is history, not current state.
    getDb()
      .select()
      .from(medications)
      .where(eq(medications.userId, userId))
      .orderBy(desc(medications.isActive), desc(medications.prescribedDate))
      .limit(LIMITS.medications),
    getDb()
      .select()
      .from(diagnoses)
      .where(eq(diagnoses.userId, userId))
      .orderBy(desc(diagnoses.diagnosedDate))
      .limit(LIMITS.diagnoses),
    // Abnormal results first, then most recent — the ones a digest should reason about.
    getDb()
      .select()
      .from(labResults)
      .where(eq(labResults.userId, userId))
      .orderBy(desc(labResults.isAbnormal), desc(labResults.testDate))
      .limit(LIMITS.labResults),
    getDb()
      .select()
      .from(allergies)
      .where(eq(allergies.userId, userId))
      .limit(LIMITS.allergies),
  ]);

  return {
    documents: docRows,
    medications: medRows,
    diagnoses: diagRows,
    labResults: labRows,
    allergies: allergyRows,
  };
}

function buildPatientSummary(data: Awaited<ReturnType<typeof fetchPatientData>>): string {
  const parts: string[] = [];

  parts.push(`Documents on record: ${data.documents.length}`);
  if (data.documents.length > 0) {
    const docList = data.documents
      .map((d) => `  - "${d.title}" (${d.documentType}, ${d.documentDate?.toISOString().slice(0, 10) ?? 'undated'})`)
      .join('\n');
    parts.push(docList);
  }

  parts.push(`\nMedications (${data.medications.length}):`);
  if (data.medications.length > 0) {
    const medList = data.medications
      .map((m) => `  - ${m.name}${m.dosage ? ` ${m.dosage}` : ''}${m.frequency ? `, ${m.frequency}` : ''}${m.isActive === false ? ' (inactive)' : ''}`)
      .join('\n');
    parts.push(medList);
  } else {
    parts.push('  None recorded');
  }

  parts.push(`\nDiagnoses (${data.diagnoses.length}):`);
  if (data.diagnoses.length > 0) {
    const diagList = data.diagnoses
      .map((d) => `  - ${d.condition}${d.severity ? ` (${d.severity})` : ''}${d.diagnosedDate ? `, diagnosed ${d.diagnosedDate.toISOString().slice(0, 10)}` : ''}`)
      .join('\n');
    parts.push(diagList);
  } else {
    parts.push('  None recorded');
  }

  parts.push(`\nLab Results (${data.labResults.length}):`);
  if (data.labResults.length > 0) {
    const labList = data.labResults
      .map((l) => `  - ${l.testName}: ${l.value}${l.unit ? ` ${l.unit}` : ''}${l.isAbnormal ? ' [ABNORMAL]' : ''}${l.referenceRange ? ` (ref: ${l.referenceRange})` : ''}`)
      .join('\n');
    parts.push(labList);
  } else {
    parts.push('  None recorded');
  }

  parts.push(`\nAllergies (${data.allergies.length}):`);
  if (data.allergies.length > 0) {
    const allergyList = data.allergies
      .map((a) => `  - ${a.allergen}${a.severity ? ` (${a.severity})` : ''}${a.reaction ? `: ${a.reaction}` : ''}`)
      .join('\n');
    parts.push(allergyList);
  } else {
    parts.push('  None recorded');
  }

  return parts.join('\n');
}

function determinePriority(findings: HealthFinding[]): string {
  if (findings.some((f) => f.priority === 'action_needed')) return 'urgent';
  if (findings.some((f) => f.priority === 'attention')) return 'elevated';
  return 'normal';
}

export async function generateHealthDigest(userId: string): Promise<HealthDigestResult> {
  const data = await fetchPatientData(userId);
  // Backstop behind the row caps: however the record is shaped, the prompt stays
  // inside the context window rather than being silently truncated mid-record.
  const patientSummary = capToTokenBudget(buildPatientSummary(data), MAX_SUMMARY_TOKENS);
  const documentIds = data.documents.map((d) => d.id);

  const response = await getGroq().chat.completions.create({
    model: MODELS.primary,
    messages: [
      { role: 'system', content: DIGEST_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Analyze the following patient health record and generate a health insight digest:\n\n${patientSummary}`,
      },
    ],
    temperature: 0.3,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from digest generation model');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error('Digest model returned malformed JSON');
  }

  const parsed = digestSchema.parse(raw);
  const findings: HealthFinding[] = parsed.findings;
  const priority = parsed.priority ?? determinePriority(findings);

  const [inserted] = await getDb()
    .insert(healthInsights)
    .values({
      userId,
      title: parsed.title,
      digest: parsed.digest,
      documentIdsReviewed: documentIds,
      findings: findings as unknown as Record<string, unknown>,
      priority,
    })
    .returning();

  return {
    id: inserted.id,
    title: inserted.title,
    digest: inserted.digest,
    findings,
    documentIdsReviewed: documentIds,
    priority: inserted.priority ?? 'normal',
    generatedAt: inserted.generatedAt ?? new Date(),
  };
}
