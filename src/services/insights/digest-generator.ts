import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { groq, MODELS } from '@/lib/groq';
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

async function fetchPatientData(userId: string) {
  const [docRows, medRows, diagRows, labRows, allergyRows] = await Promise.all([
    getDb()      .select({
        id: documents.id,
        title: documents.title,
        documentType: documents.documentType,
        documentDate: documents.documentDate,
        hospital: documents.hospital,
      })
      .from(documents)
      .where(eq(documents.userId, userId)),
    getDb()      .select()
      .from(medications)
      .where(eq(medications.userId, userId)),
    getDb()      .select()
      .from(diagnoses)
      .where(eq(diagnoses.userId, userId)),
    getDb()      .select()
      .from(labResults)
      .where(eq(labResults.userId, userId)),
    getDb()      .select()
      .from(allergies)
      .where(eq(allergies.userId, userId)),
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
  const patientSummary = buildPatientSummary(data);
  const documentIds = data.documents.map((d) => d.id);

  const response = await groq.chat.completions.create({
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

  const parsed = JSON.parse(content) as {
    title: string;
    digest: string;
    findings: HealthFinding[];
    priority?: string;
  };

  const findings = parsed.findings ?? [];
  const priority = parsed.priority ?? determinePriority(findings);

  const [inserted] = await getDb()    .insert(healthInsights)
    .values({
      userId,
      title: parsed.title ?? 'Health Insight Digest',
      digest: parsed.digest ?? 'No summary generated.',
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
