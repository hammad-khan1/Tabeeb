import { groq, MODELS } from '@/lib/groq';

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

export async function structureVoiceEntry(
  transcript: string
): Promise<VoiceStructuredEntry> {
  const response = await groq.chat.completions.create({
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

  return JSON.parse(content) as VoiceStructuredEntry;
}
