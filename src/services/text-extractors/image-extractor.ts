import { getGroq, MODELS } from '@/lib/groq';
import { withModelRetry } from '@/lib/model-errors';
import {
  normalizeForVision,
  enhanceForHandwriting,
  type NormalizedImage,
} from './image-normalizer';
import { getRadiologyClassifier, type ClassificationResult } from '@/services/radiology/classifier';
import { buildFindings, type ValidatedFinding } from '@/services/radiology/validator';

/**
 * Findings now come from `services/radiology/classifier`, a purpose-trained chest
 * X-ray model — not from the vision LLM. See that file for why.
 */
export type { ValidatedFinding as RadiologyFinding } from '@/services/radiology/validator';

export interface ImageExtractionResult {
  text: string;
  confidence: number;
  isHandwritten: boolean;
  radiologyFindings?: ValidatedFinding[];
  /** Raw classifier output, so the caller can report what was and was not checked. */
  classification?: ClassificationResult;
}

const VISION_MAX_TOKENS = 8192;

const OCR_SYSTEM_PROMPT = `You are a medical document OCR specialist working with Pakistani health records. Extract ALL text from the provided image with maximum fidelity.

Rules:
- Extract every visible character, including Urdu script (preserve the original script, never transliterate)
- Preserve the layout structure: headings, tables, lists, and spacing as closely as possible
- For tables, use pipe-delimited rows: | col1 | col2 | col3 |
- Include headers, footers, stamps, signatures, and watermark text
- Read handwriting carefully. Pakistani prescriptions commonly use these abbreviations: OD (once daily), BD/BID (twice daily), TDS/TID (three times daily), QID (four times daily), HS (at night), SOS/PRN (as needed), stat (immediately), PO (by mouth), and the dosage forms Tab, Cap, Syp, Inj, Susp. Transcribe them exactly as written — do not expand or normalize them.
- Never guess a drug name, dose, or lab value. If a character or number is uncertain, transcribe your best reading and append [unclear: what you see] immediately after it
- Do not skip a line because it is hard to read — transcribe what you can and mark the remainder [unclear]
- Do not summarize, translate, correct, or add anything that is not visibly present

Respond in this exact JSON format:
{
  "extractedText": "all extracted text here",
  "confidence": <number 0-100 estimating OCR accuracy>,
  "isHandwritten": <boolean - true if the majority of content is handwritten>
}`;

/**
 * Vision output is occasionally truncated mid-object despite response_format json_object,
 * which makes a bare JSON.parse throw and lose the whole document.
 */
function parseJsonObject<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

function clampConfidence(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
}

async function runVision(
  systemPrompt: string,
  instruction: string,
  image: NormalizedImage
): Promise<string> {
  const dataUrl = `data:${image.mimeType};base64,${image.buffer.toString('base64')}`;

  // Vision calls are the token-hungry part of the pipeline and so the first thing to
  // hit a rate limit; a short blip should not fail the whole document.
  const response = await withModelRetry(
    () => getGroq().chat.completions.create({
    model: MODELS.vision,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: instruction },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: VISION_MAX_TOKENS,
    response_format: { type: 'json_object' },
    }),
    { label: 'Vision' }
  );

  return response.choices[0]?.message?.content ?? '';
}

const REFINEMENT_SYSTEM_PROMPT = `${OCR_SYSTEM_PROMPT}

You are being given a draft transcription of this same image produced by an earlier pass that may have missed or misread parts of it. The image you now see has been contrast-enhanced.

Your job is to produce a COMPLETE and CORRECTED transcription:
- Keep every line of the draft that is correct
- Add lines, words, and numbers the draft missed entirely
- Fix readings that clearly disagree with what you can see in the enhanced image
- If the draft marked something [unclear] and you can now read it, replace the marker with the reading. If it is still unclear, keep the marker.
- Never delete content that is visibly present in the image just because the draft omitted it
- Your output must be at least as complete as the draft`;

interface OcrPass {
  text: string;
  confidence: number;
  isHandwritten: boolean;
}

/** Below this the first pass is unreliable enough that a second look is worth the latency. */
const REFINEMENT_CONFIDENCE_THRESHOLD = 80;

/**
 * A second vision pass costs roughly as many tokens as the first, which on a per-minute token
 * budget means refining a document that was already read cleanly can starve the next document's
 * first pass. So refinement is triggered only by evidence the read is incomplete — a low
 * self-reported confidence, or [unclear] markers the OCR prompt asks the model to leave behind —
 * and never by handwriting alone.
 */
const UNCLEAR_MARKER = /\[unclear/i;

/**
 * A retry that comes back materially shorter has lost content rather than corrected it, so the
 * draft is kept. The allowance covers legitimate shrinkage from resolving [unclear] markers.
 */
const MIN_REFINEMENT_LENGTH_RATIO = 0.9;

function parseOcrPass(content: string): OcrPass {
  const parsed = parseJsonObject<{
    extractedText?: string;
    confidence?: number;
    isHandwritten?: boolean;
  }>(content);

  if (!parsed) {
    return { text: '', confidence: 0, isHandwritten: false };
  }

  return {
    text: typeof parsed.extractedText === 'string' ? parsed.extractedText : '',
    confidence: clampConfidence(parsed.confidence, 50),
    isHandwritten: parsed.isHandwritten === true,
  };
}

/**
 * Handwritten prescriptions were coming back only partially transcribed from a single pass, so a
 * second pass reads a contrast-enhanced rendering with the first transcription supplied as a
 * draft to complete. Failures fall back to the first pass rather than losing the document.
 */
async function refineHandwriting(
  buffer: Buffer,
  mimeType: string,
  draft: OcrPass
): Promise<OcrPass> {
  try {
    const enhanced = await enhanceForHandwriting(buffer, mimeType);
    const refined = parseOcrPass(
      await runVision(
        REFINEMENT_SYSTEM_PROMPT,
        `Draft transcription from the previous pass:\n"""\n${draft.text}\n"""\n\nProduce the complete, corrected transcription of this image.`,
        enhanced
      )
    );

    if (refined.text.trim().length < draft.text.trim().length * MIN_REFINEMENT_LENGTH_RATIO) {
      return draft;
    }

    return {
      text: refined.text,
      confidence: Math.max(refined.confidence, draft.confidence),
      isHandwritten: draft.isHandwritten || refined.isHandwritten,
    };
  } catch (error) {
    console.warn(
      '[OCR] handwriting refinement pass skipped:',
      error instanceof Error ? error.message : error
    );
    return draft;
  }
}

export async function ocrImage(buffer: Buffer, mimeType: string): Promise<OcrPass> {
  const normalized = await normalizeForVision(buffer, mimeType);
  const first = parseOcrPass(
    await runVision(
      OCR_SYSTEM_PROMPT,
      'Extract all text from this medical document image.',
      normalized
    )
  );

  const needsRefinement =
    first.text.trim().length > 0 &&
    (first.confidence < REFINEMENT_CONFIDENCE_THRESHOLD || UNCLEAR_MARKER.test(first.text));

  if (!needsRefinement) return first;

  return refineHandwriting(buffer, mimeType, first);
}

/**
 * Runs the chest X-ray classifier over the image.
 *
 * This used to prompt the general-purpose vision LLM as "a board-certified radiologist
 * AI performing clinical-grade analysis" and take whatever it produced. A general VLM
 * cannot detect a pneumothorax or a fracture; it produced fluent, unfounded findings
 * that were stored as clinical data. Detection is now the classifier's job, and when
 * none is configured no findings are produced at all.
 */
async function classifyRadiologyImage(
  buffer: Buffer,
  mimeType: string
): Promise<{ findings: ValidatedFinding[]; classification: ClassificationResult }> {
  const normalized = await normalizeForVision(buffer, mimeType);
  const classification = await getRadiologyClassifier().classify(
    normalized.buffer,
    normalized.mimeType
  );
  return { findings: buildFindings(classification), classification };
}

export async function extractFromImage(
  buffer: Buffer,
  mimeType: string,
  documentType?: string
): Promise<ImageExtractionResult> {
  const ocr = await ocrImage(buffer, mimeType);

  const result: ImageExtractionResult = {
    text: ocr.text,
    confidence: ocr.confidence,
    isHandwritten: ocr.isHandwritten,
  };

  if (documentType === 'imaging_report') {
    const { findings, classification } = await classifyRadiologyImage(buffer, mimeType);
    result.radiologyFindings = findings;
    result.classification = classification;
  }

  return result;
}
