import { z } from 'zod';
import { getGroq, MODELS } from '@/lib/groq';
import { DOCUMENT_TYPES } from '@/lib/validation';

export interface VoiceStructuredEntry {
  documentType: string;
  title: string;
  description: string;
  medications: Array<{ name: string; dosage?: string; frequency?: string }>;
  symptoms: string[];
  date?: string;
  doctorName?: string;
  hospital?: string;
  conditions: string[];
}

const STRUCTURER_SYSTEM_PROMPT = `Extract structured medical information from this patient voice note. Return JSON with: { documentType, title, description, medications: [{name, dosage, frequency}], symptoms: [], date, doctorName, hospital, conditions: [] }

Rules:
- Handle mixed Urdu/English naturally — preserve original phrasing where useful
- documentType should be one of: prescription, lab_report, discharge_summary, consultation_note, voice_entry, other
- Return empty arrays for categories with no findings
- Infer a short title from the content
- Use YYYY-MM-DD format for dates when identifiable
- Do NOT invent data that is not present in the transcript`;

/**
 * The model's JSON was cast straight to the interface with no check, so a malformed
 * or partial response propagated as a well-typed lie. `.catch()` on each field keeps
 * a single bad field from discarding the whole transcript.
 */
const voiceEntrySchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES).catch('voice_entry'),
  title: z.string().trim().min(1).max(200).catch('Voice note'),
  description: z.string().trim().max(4000).catch(''),
  medications: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        dosage: z.string().trim().max(100).optional(),
        frequency: z.string().trim().max(100).optional(),
      })
    )
    .max(50)
    .catch([]),
  symptoms: z.array(z.string().trim().min(1).max(200)).max(50).catch([]),
  date: z.string().trim().max(50).optional().catch(undefined),
  doctorName: z.string().trim().max(200).optional().catch(undefined),
  hospital: z.string().trim().max(200).optional().catch(undefined),
  conditions: z.array(z.string().trim().min(1).max(200)).max(50).catch([]),
});

export async function structureVoiceEntry(
  transcript: string
): Promise<VoiceStructuredEntry> {
  const response = await getGroq().chat.completions.create({
    model: MODELS.fast,
    messages: [
      { role: 'system', content: STRUCTURER_SYSTEM_PROMPT },
      { role: 'user', content: transcript },
    ],
    temperature: 0.2,
    max_tokens: 2048,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from structuring model');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error('Structuring model returned malformed JSON');
  }

  return voiceEntrySchema.parse(raw);
}
