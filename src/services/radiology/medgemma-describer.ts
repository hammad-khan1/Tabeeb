/**
 * Describes a radiograph using MedGemma, Google Health's medical vision-language model.
 *
 * Why this is separate from the classifier, and shaped differently:
 *
 * The chest classifier returns calibrated probabilities per pathology, so findings can
 * be *derived* from numbers and nothing is generated. MedGemma is a language model — it
 * writes prose. Treating its output as findings, with confidence percentages and
 * urgency levels, would recreate exactly the failure this feature was rebuilt to fix:
 * fluent, structured, unfounded clinical data.
 *
 * So it is deliberately confined to a *description* of what is visible, stored as text
 * and labelled as such. It never produces `imagingFindings` rows, never carries a
 * confidence score, and never claims a diagnosis.
 *
 * What it buys is coverage. The chest classifier only knows chests; MedGemma was
 * trained across body regions and modalities, so a foot, an ankle or a wrist gets
 * something useful instead of "not supported".
 */

const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'medgemma:4b';

/** Local inference on a 4B model; slow but not unbounded. */
const REQUEST_TIMEOUT_MS = 180_000;

/** Body regions the description model is asked to choose between. */
export type BodyRegion =
  | 'chest'
  | 'abdomen'
  | 'spine'
  | 'upper limb'
  | 'lower limb'
  | 'skull'
  | 'pelvis'
  | 'other'
  /** The image is not a radiograph at all — a photographed document, say. */
  | 'not an x-ray'
  | 'unknown';

const BODY_REGIONS: readonly BodyRegion[] = [
  'chest', 'abdomen', 'spine', 'upper limb', 'lower limb', 'skull', 'pelvis', 'other',
  'not an x-ray',
];

export interface RadiographDescription {
  /** Plain-language account of what is visible. Never a diagnosis. */
  description: string;
  modelId: string;
  /** Set when description could not be produced; `description` is then empty. */
  unavailableReason?: string;
  /** True when the model reassured despite being told not to, and was corrected. */
  reassuranceCorrected?: boolean;
  /**
   * Which part of the body this is. Gates the chest classifier, which otherwise scores
   * chest pathologies on whatever pixels it is handed — it reported pneumonia at 73%
   * on a leg X-ray.
   */
  bodyRegion: BodyRegion;
}

const SYSTEM_PROMPT = `You are helping a patient understand what their X-ray image shows. You are not a radiologist and you are not making a diagnosis.

Describe, in plain language a non-medical reader can follow:
- which part of the body this is, and the view if you can tell
- what structures are visible
- anything that looks different from the expected appearance, described plainly

Hard rules:
- Describe only what is visible in this image. Never infer history, cause, or treatment.
- Do not state a diagnosis. Say "this area looks…" rather than "this is a fracture".
- If the image is unclear, poorly exposed, or you cannot tell, say so plainly. That is a useful answer.
- If it is a photograph of a film rather than the image itself, say that glare or angle limits what can be read.
- Do not invent measurements, dates, or clinical detail that is not visible.
- Never reassure. Do not say anything looks normal or healthy — you are not able to rule anything out.
- End with one sentence telling the patient this needs a doctor's reading.
- Keep it under 200 words.

Begin your reply with a single line of exactly this form, then a blank line, then the description:
REGION: <one of: chest, abdomen, spine, upper limb, lower limb, skull, pelvis, other, not an x-ray>

If the image is not a radiograph at all — a photograph of a paper document, a prescription, a screenshot — write "REGION: not an x-ray" and say so in one sentence instead of describing anatomy.
If it is an X-ray but you cannot tell which part of the body it is, write "REGION: other".`;

/**
 * Reassurance the model emits despite being told not to.
 *
 * Observed in testing: asked to describe a foot X-ray it could barely read, it still
 * wrote "the bones appear generally normal in shape". That is the one thing this
 * feature must never say. A patient who reads it may not see a doctor about a
 * fracture, and the model cannot rule anything out — it is describing a picture.
 *
 * Prompt instructions alone did not hold, so the output is checked.
 */
const NEGATIVE_FINDING =
  '(?:break|breaks|fracture|fractures|dislocation|dislocations|abnormalit(?:y|ies)|damage|injur(?:y|ies)|problem|problems|issue|issues)';

const REASSURANCE = [
  /\b(?:appears?|looks?|seems?)\b[^.!?]{0,40}\b(?:normal|unremarkable|healthy|fine|intact|okay|ok)\b/i,
  // "no obvious fracture"
  new RegExp(
    `\\bno (?:obvious |apparent |clear |visible |significant |definite )?${NEGATIVE_FINDING}\\b`,
    'i'
  ),
  // "does not appear to be any obvious fractures" / "cannot see any breaks" — the
  // phrasing the model actually produced, which the "no <finding>" pattern missed.
  // "cannot" has no word boundary before "not", so it needs listing explicitly.
  new RegExp(
    `(?:\\bnot\\b|n't|\\bwithout\\b|\\bcannot\\b|\\bunable to\\b)[^.!?]{0,50}\\b(?:any |obvious |apparent |visible )*${NEGATIVE_FINDING}\\b`,
    'i'
  ),
  /\b(?:nothing|no evidence|no sign)\b[^.!?]{0,40}\b(?:concerning|abnormal|wrong|worrying|broken|fractur)/i,
  /\bwithin normal limits\b/i,
  /\b(?:bones?|structures?|alignment)\b[^.!?]{0,30}\b(?:intact|preserved|maintained)\b/i,
];

function containsReassurance(text: string): boolean {
  return REASSURANCE.some((pattern) => pattern.test(text));
}

/** Test seam for the guard, which is otherwise only reachable through a model call. */
export const __testContainsReassurance = containsReassurance;

/**
 * Pulls the REGION line off the front of the reply. An unparseable or missing region
 * becomes 'unknown', which is treated as "not a chest" — the safe direction, since the
 * only thing gated on it is whether the chest classifier is allowed to run.
 */
function splitRegion(raw: string): { bodyRegion: BodyRegion; description: string } {
  const match = raw.match(/^\s*REGION:\s*([a-z ]+)\s*$/im);
  const description = raw.replace(/^\s*REGION:.*$/im, '').trim();

  if (!match) return { bodyRegion: 'unknown', description: raw.trim() };

  const stated = match[1].trim().toLowerCase();
  const region = BODY_REGIONS.find((candidate) => candidate === stated);
  return { bodyRegion: region ?? 'unknown', description };
}

interface OllamaResponse {
  message?: { content?: string };
  error?: string;
}

function endpoint(): string {
  return (process.env.MEDGEMMA_ENDPOINT?.trim() || DEFAULT_ENDPOINT).replace(/\/+$/, '');
}

function modelId(): string {
  return process.env.MEDGEMMA_MODEL?.trim() || DEFAULT_MODEL;
}

export function isMedGemmaConfigured(): boolean {
  // Enabled by default when an endpoint is reachable; explicitly switchable off.
  return process.env.MEDGEMMA_DISABLED !== '1';
}

/**
 * Never throws: a description is an enhancement, so a failure degrades to "not
 * described" rather than failing the document.
 */
export async function describeRadiograph(
  image: Buffer,
  bodyPartHint?: string
): Promise<RadiographDescription> {
  const model = modelId();

  if (!isMedGemmaConfigured()) {
    return {
      description: '',
      modelId: model,
      bodyRegion: 'unknown',
      unavailableReason: 'Image description is disabled.',
    };
  }

  const instruction = bodyPartHint
    ? `Describe what this X-ray of the ${bodyPartHint} shows.`
    : 'Describe what this X-ray shows.';

  try {
    const response = await fetch(`${endpoint()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        stream: false,
        // Low temperature: this should read the image, not write around it.
        options: { temperature: 0.2, num_predict: 400 },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: instruction, images: [image.toString('base64')] },
        ],
      }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      return {
        description: '',
        modelId: model,
        bodyRegion: 'unknown',
        unavailableReason: `The image description model returned ${response.status}. ${detail}`,
      };
    }

    const payload = (await response.json()) as OllamaResponse;
    if (payload.error) {
      return { description: '', modelId: model, bodyRegion: 'unknown', unavailableReason: payload.error };
    }

    const raw = payload.message?.content?.trim() ?? '';
    if (!raw) {
      return {
        description: '',
        modelId: model,
        bodyRegion: 'unknown',
        unavailableReason: 'The image description model returned nothing.',
      };
    }

    const { bodyRegion, description } = splitRegion(raw);
    if (!description) {
      return {
        description: '',
        modelId: model,
        bodyRegion,
        unavailableReason: 'The image description model returned nothing usable.',
      };
    }

    return {
      description,
      modelId: model,
      bodyRegion,
      reassuranceCorrected: containsReassurance(description),
    };
  } catch (error) {
    return {
      description: '',
      modelId: model,
      bodyRegion: 'unknown',
      unavailableReason: `The image description model could not be reached: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    };
  }
}

/**
 * The note stored on the document. Framed so a patient cannot read it as a clinical
 * result: it says what produced it and what it is not.
 */
export function buildDescriptionNote(result: RadiographDescription): string | null {
  if (!result.description) return null;

  const parts = [
    `What this image appears to show, read by an AI model (${result.modelId}): ` +
      result.description,
  ];

  // The model said something looked normal. It cannot know that, and a patient acting
  // on it might not get a real injury looked at, so the claim is contradicted directly
  // rather than quietly left standing.
  if (result.reassuranceCorrected) {
    parts.push(
      'Note: the description above suggests something looks normal. Disregard that — ' +
        'this model cannot rule out a fracture or any other problem, and nothing here ' +
        'means your X-ray is clear.'
    );
  }

  parts.push(
    'This is a description of the picture, not a diagnosis and not a radiologist’s ' +
      'report. It cannot rule anything out. Only a doctor can tell you what your X-ray means.'
  );

  return parts.join('\n\n');
}
