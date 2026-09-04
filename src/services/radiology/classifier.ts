import { huggingFaceApiKey } from '@/lib/env';

/**
 * Chest X-ray pathology classification.
 *
 * The previous implementation handed the image to a general-purpose vision LLM under a
 * prompt telling it that it was "a board-certified radiologist AI performing
 * clinical-grade analysis", and asked it to report fractures, masses and pneumothorax
 * with confidence scores. A general VLM cannot do that. It produced fluent, plausible,
 * unfounded findings, which were then stored with `validated: true` — the same failure
 * mode as the retired drug-interaction API: invented clinical data presented as analysis.
 *
 * This replaces it with a purpose-trained classifier. The model returns a calibrated
 * probability per pathology; nothing here invents a finding, and when no classifier is
 * configured the app reports that no image analysis was performed rather than falling
 * back to the LLM.
 *
 * IMPORTANT, and reflected in every label this produces: a CheXNet-class model is a
 * triage and decision-support tool, not a diagnosis. None of the openly available
 * chest X-ray models are cleared as a medical device, they are trained almost entirely
 * on frontal adult chest films, and their published performance comes from the same
 * datasets they were trained on. Output must always reach the patient as "an automated
 * screening flag to discuss with a doctor".
 */

/** The 18-label chest pathology set shared by CheXNet, CheXpert and TorchXRayVision. */
export const PATHOLOGIES = [
  'Atelectasis',
  'Cardiomegaly',
  'Consolidation',
  'Edema',
  'Effusion',
  'Emphysema',
  'Enlarged Cardiomediastinum',
  'Fibrosis',
  'Fracture',
  'Hernia',
  'Infiltration',
  'Lung Lesion',
  'Lung Opacity',
  'Mass',
  'Nodule',
  'Pleural Thickening',
  'Pneumonia',
  'Pneumothorax',
] as const;

export type Pathology = (typeof PATHOLOGIES)[number];

export interface PathologyScore {
  pathology: Pathology;
  /** 0-1 as reported by the model. Not a probability of disease in this patient. */
  probability: number;
}

export interface ClassificationResult {
  scores: PathologyScore[];
  /** Scores at or above the reporting threshold, highest first. */
  flagged: PathologyScore[];
  modelId: string;
  /** Set when classification could not run; `scores` is then empty. */
  unavailableReason?: string;
}

/**
 * Reporting threshold. Deliberately conservative in the direction of showing a flag:
 * a missed finding a patient never discusses with a doctor is worse than an extra one
 * they do — but every flag is labelled as needing confirmation, and the number is
 * shown, so the patient is never handed a bare yes/no.
 */
const REPORT_THRESHOLD = 0.5;

/** Findings that should always surface for discussion even at lower confidence. */
const URGENT_PATHOLOGIES: ReadonlySet<Pathology> = new Set([
  'Pneumothorax',
  'Mass',
  'Nodule',
  'Fracture',
]);
const URGENT_THRESHOLD = 0.35;

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Model label → canonical pathology. Different checkpoints spell these differently
 * ("pleural_effusion", "Effusion", "LABEL_4"), so anything unmapped is dropped rather
 * than guessed at.
 */
const LABEL_ALIASES: Record<string, Pathology> = {
  atelectasis: 'Atelectasis',
  cardiomegaly: 'Cardiomegaly',
  consolidation: 'Consolidation',
  edema: 'Edema',
  pulmonary_edema: 'Edema',
  effusion: 'Effusion',
  pleural_effusion: 'Effusion',
  emphysema: 'Emphysema',
  enlarged_cardiomediastinum: 'Enlarged Cardiomediastinum',
  fibrosis: 'Fibrosis',
  lung_fibrosis: 'Fibrosis',
  fracture: 'Fracture',
  rib_fracture: 'Fracture',
  hernia: 'Hernia',
  infiltration: 'Infiltration',
  infiltrate: 'Infiltration',
  lung_lesion: 'Lung Lesion',
  lesion: 'Lung Lesion',
  lung_opacity: 'Lung Opacity',
  opacity: 'Lung Opacity',
  mass: 'Mass',
  nodule: 'Nodule',
  pleural_thickening: 'Pleural Thickening',
  pneumonia: 'Pneumonia',
  pneumothorax: 'Pneumothorax',
};

function canonicalLabel(raw: string): Pathology | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return LABEL_ALIASES[key] ?? null;
}

export interface RadiologyClassifier {
  readonly modelId: string;
  isConfigured(): boolean;
  classify(image: Buffer, mimeType: string): Promise<ClassificationResult>;
}

interface HfClassification {
  label?: string;
  score?: number;
}

/**
 * HuggingFace-hosted classifier. Works with a dedicated Inference Endpoint (the
 * reliable option — set RADIOLOGY_CLASSIFIER_URL to its URL) or with the serverless
 * router for models that still have a provider behind them.
 */
class HuggingFaceClassifier implements RadiologyClassifier {
  readonly modelId: string;
  private readonly endpoint: string;

  constructor(modelId: string, endpoint: string) {
    this.modelId = modelId;
    this.endpoint = endpoint;
  }

  isConfigured(): boolean {
    return Boolean(huggingFaceApiKey());
  }

  async classify(image: Buffer, mimeType: string): Promise<ClassificationResult> {
    const apiKey = huggingFaceApiKey();
    if (!apiKey) {
      return this.unavailable('No HuggingFace API key is configured.');
    }

    let payload: unknown;
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': mimeType,
        },
        body: new Uint8Array(image),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        return this.unavailable(
          `The image analysis model returned ${response.status}. ${detail}`
        );
      }
      payload = await response.json();
    } catch (error) {
      return this.unavailable(
        `The image analysis model could not be reached: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    }

    if (!Array.isArray(payload)) {
      return this.unavailable('The image analysis model returned an unexpected response.');
    }

    const scores: PathologyScore[] = [];
    for (const entry of payload as HfClassification[]) {
      const pathology = canonicalLabel(entry.label ?? '');
      const probability = Number(entry.score);
      if (!pathology || !Number.isFinite(probability)) continue;
      scores.push({ pathology, probability: Math.min(1, Math.max(0, probability)) });
    }

    if (scores.length === 0) {
      return this.unavailable(
        'The image analysis model returned no recognised pathology labels.'
      );
    }

    scores.sort((a, b) => b.probability - a.probability);
    return { scores, flagged: selectFlagged(scores), modelId: this.modelId };
  }

  private unavailable(reason: string): ClassificationResult {
    return { scores: [], flagged: [], modelId: this.modelId, unavailableReason: reason };
  }
}

/** Used when nothing is configured. Never invents a result. */
class NullClassifier implements RadiologyClassifier {
  readonly modelId = 'none';
  isConfigured(): boolean {
    return false;
  }
  async classify(): Promise<ClassificationResult> {
    return {
      scores: [],
      flagged: [],
      modelId: this.modelId,
      unavailableReason:
        'No X-ray analysis model is configured, so this image was not analysed. Only text found on the image was read.',
    };
  }
}

export function selectFlagged(scores: PathologyScore[]): PathologyScore[] {
  return scores
    .filter((s) =>
      URGENT_PATHOLOGIES.has(s.pathology)
        ? s.probability >= URGENT_THRESHOLD
        : s.probability >= REPORT_THRESHOLD
    )
    .sort((a, b) => b.probability - a.probability);
}

let cached: RadiologyClassifier | null = null;

/**
 * Resolves the configured classifier. Set RADIOLOGY_CLASSIFIER_URL to a HuggingFace
 * Inference Endpoint serving a chest X-ray multi-label model (TorchXRayVision's
 * densenet121-res224-all is the reference), plus HF_API_KEY. With neither set, the
 * app truthfully reports that no analysis was performed.
 */
export function getRadiologyClassifier(): RadiologyClassifier {
  if (cached) return cached;

  const url = process.env.RADIOLOGY_CLASSIFIER_URL?.trim();
  const modelId =
    process.env.RADIOLOGY_CLASSIFIER_MODEL?.trim() ||
    'torchxrayvision/densenet121-res224-all';

  if (url && huggingFaceApiKey()) {
    cached = new HuggingFaceClassifier(modelId, url);
  } else {
    cached = new NullClassifier();
  }
  return cached;
}

/** Test seam. */
export function resetRadiologyClassifier(): void {
  cached = null;
}
