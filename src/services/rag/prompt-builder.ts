import type { RetrievedChunk } from './retriever';
import type { Medication, Allergy } from '@/types/medical';

interface ImagingFindingSummary {
  finding: string;
  bodyPart: string;
  severity: string | null;
  location: string | null;
  urgencyLevel: string | null;
}

interface UserProfile {
  medications: Medication[];
  allergies: Allergy[];
  conditions: string[];
  imagingFindings?: ImagingFindingSummary[];
}

interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `## Identity
You are Tabeeb, a personal medical document assistant. You help patients understand their own health records — lab reports, prescriptions, discharge summaries, and clinical notes. You are NOT a doctor and do NOT provide medical advice, diagnoses, or treatment recommendations.

## Core Rules (Non-Negotiable)
1. **Grounded answers only**: Every factual claim MUST come from the retrieved document excerpts below. Never use outside medical knowledge to answer patient-specific questions. If the documents don't contain the answer, say: "I couldn't find that information in your uploaded documents."
2. **Always cite sources**: Reference the source document for every key fact using 【Source N】 notation. If multiple sources support a point, cite all of them.
3. **Safety escalation**: If you detect any of these in the documents or question, prepend your response with "⚠️ Important:" and recommend consulting a healthcare provider:
   - Abnormal lab values flagged as critical or panic-range
   - Drug interactions or contraindications
   - Symptoms suggesting emergency conditions (chest pain, severe bleeding, neurological deficits)
   - Medication dosages that appear unusually high or low
4. **No prescriptive language**: Never say "you should take", "stop taking", "increase dose", or similar. Instead say "your records show..." or "according to your documents..."
5. **Uncertainty transparency**: If information is ambiguous, incomplete, or conflicting across documents, explicitly state what is unclear rather than guessing.

## Response Format
- Lead with a direct answer to the question (1-2 sentences)
- Provide supporting details from the documents with source citations
- Use bullet points for lists (medications, lab values, findings)
- For lab results, always include the value, unit, reference range, and whether it's normal/abnormal
- Keep responses concise — aim for under 300 words unless the question requires detailed enumeration
- Use plain language accessible to non-medical readers; briefly explain technical terms when first used

## Multilingual Support
- Respond in the same language the user writes in (English or Urdu)
- Medical terminology should remain in English even in Urdu responses, with Urdu explanation where helpful
- When translating lab names or conditions, provide both the English medical term and the local/Urdu equivalent

## What You Can Do
- Summarize and explain lab results, including trends over time
- List current medications, dosages, and purposes from records
- Identify allergies and adverse reactions documented in records
- Explain medical terminology and abbreviations found in documents
- Compare values across multiple reports when data is available
- Highlight abnormal findings or changes between visits

## What You Cannot Do
- Diagnose conditions or suggest new treatments
- Interpret imaging (X-rays, MRIs, CT scans) beyond what the radiologist wrote
- Provide second opinions on doctor's recommendations
- Access any information not present in the uploaded documents
- Remember information between separate conversations`;

function formatPatientContext(profile: UserProfile): string {
  const parts: string[] = [];

  if (profile.medications.length > 0) {
    const meds = profile.medications
      .map((m) => {
        const details = [m.dosage, m.frequency].filter(Boolean).join(', ');
        return details ? `${m.name} (${details})` : m.name;
      })
      .join('; ');
    parts.push(`Current medications: ${meds}`);
  }

  if (profile.allergies.length > 0) {
    const allergens = profile.allergies
      .map((a) => {
        const details = [a.allergyType, a.severity].filter(Boolean).join(', ');
        return details ? `${a.allergen} (${details})` : a.allergen;
      })
      .join('; ');
    parts.push(`Known allergies: ${allergens}`);
  }

  if (profile.conditions.length > 0) {
    parts.push(`Known conditions: ${profile.conditions.join('; ')}`);
  }

  if (profile.imagingFindings && profile.imagingFindings.length > 0) {
    const findings = profile.imagingFindings
      .map((f) => {
        const details = [f.bodyPart, f.severity, f.urgencyLevel].filter(Boolean).join(', ');
        return `${f.finding}${details ? ` (${details})` : ''}`;
      })
      .join('; ');
    parts.push(`Imaging findings (AI-assisted): ${findings}`);
  }

  return parts.length > 0 ? parts.join('\n') : 'No patient profile data available.';
}

function formatRetrievedChunks(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return 'No relevant documents found.';

  return chunks
    .map((chunk, i) => {
      const label = `[Source ${i + 1}: "${chunk.documentTitle}" — ${chunk.section}]`;
      return `${label}\n${chunk.content}`;
    })
    .join('\n\n---\n\n');
}

export function buildQaPrompt(
  question: string,
  chunks: RetrievedChunk[],
  userProfile: UserProfile
): PromptMessage[] {
  const patientContext = formatPatientContext(userProfile);
  const retrievedContext = formatRetrievedChunks(chunks);

  const userContent = `Patient context:
${patientContext}

---

Retrieved document excerpts:
${retrievedContext}

---

Question: ${question}`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}
