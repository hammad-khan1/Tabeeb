import { getGroq, MODELS } from '@/lib/groq';
import type { ValidatedExtraction } from '@/services/extraction-schema';

/**
 * The summary a patient reads. It must describe only what is in the document they uploaded, in
 * everyday language, so they can recognise their own report in it — not a clinical restatement.
 */

export interface SummaryInput {
  text: string;
  extraction: ValidatedExtraction;
  documentType: string;
  /** Language of the document itself; the patient's setting overrides it when present. */
  language: 'en' | 'ur' | 'mixed';
  isHandwritten: boolean;
  confidence: number | null;
}

/** Enough context for a faithful summary without paying for the whole document. */
const MAX_TEXT_CHARS = 12_000;

const LOW_CONFIDENCE_THRESHOLD = 60;

const LANGUAGE_INSTRUCTION: Record<SummaryInput['language'], string> = {
  en: 'Write the summary in plain English.',
  ur: 'Write the summary in plain Urdu, using Urdu script. Keep medicine names in Latin script exactly as written on the document, because that is how the patient will find them on the box.',
  mixed:
    'Write the summary in plain English, but keep medicine names, test names and any Urdu words exactly as they appear on the document so the patient can match them to the paper.',
};

const SUMMARY_SYSTEM_PROMPT = `You are explaining a medical document back to the patient who uploaded it. The patient is not a doctor and may have limited formal education.

Write a short, warm, plain-language summary of THIS document.

Structure it as flowing prose in 2 to 5 short paragraphs. Do not use headings, bullet points, markdown, or numbered lists.

What to cover, only if the document actually contains it:
- What kind of document this is and who issued it (doctor, hospital, date) in the first sentence, so the patient immediately recognises the paper they uploaded
- Which medicines were prescribed, how much, and when to take them — say "one tablet twice a day" rather than "1 tab BD"
- What condition or problem the document is about, explained in everyday words
- Which test results are outside the normal range and what that number is generally about, in one clause
- Any instruction the document gives, such as a follow-up date or a test to repeat

Hard rules:
- Describe ONLY what is in the document. Never add advice, diagnosis, cause, prognosis or treatment that is not written there.
- Never invent or "tidy up" a number, dose, date or medicine name. If the document is unclear about something, say plainly that it could not be read clearly.
- Expand clinical shorthand into everyday words, but keep the medicine's own name unchanged.
- Do not use the words "the document states" repeatedly; write naturally, addressing the patient as "you" and "your".
- Never tell the patient to stop, start or change a medicine. If something looks concerning, say only that they should discuss it with their doctor.
- Do not begin with "Here is a summary" or any preamble. Start directly with the content.`;

function buildEntityDigest(extraction: ValidatedExtraction): string {
  const lines: string[] = [];

  if (extraction.medications.length > 0) {
    const medications = extraction.medications
      .map((medication) =>
        [medication.name, medication.dosage, medication.frequency, medication.duration]
          .filter(Boolean)
          .join(' ')
      )
      .filter(Boolean);
    lines.push(`Medicines found: ${medications.join('; ')}`);
  }

  if (extraction.diagnoses.length > 0) {
    const diagnoses = extraction.diagnoses
      .map((diagnosis) => [diagnosis.condition, diagnosis.severity].filter(Boolean).join(', '))
      .filter(Boolean);
    lines.push(`Conditions found: ${diagnoses.join('; ')}`);
  }

  if (extraction.labResults.length > 0) {
    const labs = extraction.labResults
      .map((lab) => {
        const value = [lab.value, lab.unit].filter(Boolean).join(' ');
        const range = lab.referenceRange ? ` (normal ${lab.referenceRange})` : '';
        const flag = lab.isAbnormal ? ' [outside normal range]' : '';
        return `${lab.testName}: ${value}${range}${flag}`;
      })
      .filter(Boolean);
    lines.push(`Test results found: ${labs.join('; ')}`);
  }

  if (extraction.allergies.length > 0) {
    const allergies = extraction.allergies
      .map((allergy) => [allergy.allergen, allergy.reaction].filter(Boolean).join(' — '))
      .filter(Boolean);
    lines.push(`Allergies found: ${allergies.join('; ')}`);
  }

  return lines.join('\n');
}

function buildReliabilityNote(input: SummaryInput): string {
  const concerns: string[] = [];
  if (input.isHandwritten) concerns.push('this document is handwritten');
  if (input.confidence !== null && input.confidence < LOW_CONFIDENCE_THRESHOLD) {
    concerns.push(`the scan was only ${input.confidence}% legible`);
  }
  if (concerns.length === 0) return '';

  return `\nReliability: ${concerns.join(' and ')}. Close the summary with one short sentence telling the patient to check the medicine names and numbers against the original paper.`;
}

/**
 * Never throws — a document is still useful without a summary, so failure returns null and the
 * caller leaves the column empty rather than failing the whole upload.
 */
export async function generateDocumentSummary(input: SummaryInput): Promise<string | null> {
  const text = input.text.trim();
  if (!text) return null;

  const digest = buildEntityDigest(input.extraction);

  const userContent = [
    `Document type: ${input.documentType}`,
    LANGUAGE_INSTRUCTION[input.language],
    digest ? `\nEntities already extracted from this document:\n${digest}` : '',
    buildReliabilityNote(input),
    `\nFull text of the document:\n"""\n${text.slice(0, MAX_TEXT_CHARS)}\n"""`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await getGroq().chat.completions.create({
      model: MODELS.primary,
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      // Enough warmth to read as human, low enough not to drift from the document.
      temperature: 0.35,
      max_tokens: 1200,
    });

    const summary = response.choices[0]?.message?.content?.trim();
    return summary || null;
  } catch (error) {
    console.warn(
      '[Summary] generation skipped:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}
