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
  /**
   * Many scores bunched near the operating point. Reported as a caveat rather than a
   * refusal — see hasFlatDistribution.
   */
  lowConfidenceSpread?: boolean;
}

/**
 * Reporting threshold. Scores come out of op_norm, which rescales each pathology about
 * its own calibrated operating point — so 0.5 *is* the model's decision boundary, and
 * this reports what the model itself considers positive.
 *
 * An earlier version dropped time-critical findings to 0.35 on the theory that a
 * missed pneumothorax is worse than an extra conversation. In practice that reported
 * "pneumothorax, critical, 41%" from a photograph the model could not read at all.
 * Below the operating point the model is saying no; overriding its own calibration
 * manufactures alarms rather than catching real ones.
 */
const REPORT_THRESHOLD = 0.5;

/**
 * How many findings a patient is shown. On an abnormal chest many pathologies clear
 * the boundary together — the miliary TB film flagged eleven, led by a 51%
 * pneumothorax — which reads as a catastrophe and conveys nothing. The strongest few,
 * ranked, are informative; a wall of near-threshold labels is not.
 */
const MAX_REPORTED_FINDINGS = 4;

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Free-tier hosts (HuggingFace Spaces, Render, Fly) suspend an idle container and
 * take 30-60s to wake it. The first request after a quiet period therefore times out
 * or returns a 503 through no fault of the image, so one retry with a long timeout
 * covers the wake-up. This is what makes a free host viable rather than maddening.
 */
const COLD_START_TIMEOUT_MS = 90_000;

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

    const send = (timeoutMs: number) =>
      fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': mimeType,
        },
        body: new Uint8Array(image),
        signal: AbortSignal.timeout(timeoutMs),
      });

    let payload: unknown;
    try {
      let response = await send(REQUEST_TIMEOUT_MS).catch((error: unknown) => {
        // A timeout on a sleeping container is not a failure yet.
        if (error instanceof Error && error.name === 'TimeoutError') return null;
        throw error;
      });

      // 503 is what a waking container returns while it boots.
      if (response === null || response.status === 503) {
        console.warn('[Radiology] classifier appears to be waking, retrying');
        response = await send(COLD_START_TIMEOUT_MS);
      }

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

    return {
      scores,
      flagged: selectFlagged(scores),
      modelId: this.modelId,
      lowConfidenceSpread: hasFlatDistribution(scores),
    };
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

/**
 * Whether many scores sit bunched near the operating point.
 *
 * This began as a refusal gate and that was a mistake. It was calibrated on a
 * *normal* chest film, where the model drives every pathology near zero — so a high
 * median read as "no signal". But an *abnormal* chest elevates many pathologies at
 * once, which is the whole reason the tool exists. Measured on a clean, well-exposed
 * frontal chest X-ray showing miliary TB, the median was 0.505 and eleven of eighteen
 * scores fell in the uncertain band; the gate suppressed a result whose top findings
 * (nodule, mass, infiltration) were clinically plausible for that disease.
 *
 * A guard that silently hides findings for sick patients is worse than no guard. The
 * dangerous case it was really standing in for — the chest model scoring a foot — is
 * now handled properly by body-region routing upstream.
 *
 * So it no longer refuses. It flags a flat distribution as a caveat on the result,
 * and the caller shows the numbers either way.
 */
const FLAT_MEDIAN_SCORE = 0.45;
const FLAT_UNCERTAIN_FRACTION = 0.5;
const UNCERTAIN_BAND: readonly [number, number] = [0.45, 0.55];

export function hasFlatDistribution(scores: PathologyScore[]): boolean {
  if (scores.length < 5) return false;

  const values = scores.map((s) => s.probability).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const median =
    values.length % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];

  const uncertain =
    values.filter((v) => v >= UNCERTAIN_BAND[0] && v <= UNCERTAIN_BAND[1]).length /
    values.length;

  return median >= FLAT_MEDIAN_SCORE && uncertain >= FLAT_UNCERTAIN_FRACTION;
}

export function selectFlagged(scores: PathologyScore[]): PathologyScore[] {
  return scores
    .filter((s) => s.probability >= REPORT_THRESHOLD)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, MAX_REPORTED_FINDINGS);
}

let cached: RadiologyClassifier | null = null;

/**
 * Resolves the classifier backend, in order:
 *
 *  1. an explicit RADIOLOGY_CLASSIFIER_URL — a hosted endpoint wins when set, so a
 *     deployment can override the bundled model without a code change;
 *  2. the ONNX model bundled in models/, run in-process — no service to deploy, no
 *     cold start, and the image never leaves the server;
 *  3. nothing, in which case the app says the image was not analysed rather than
 *     inventing findings.
 *
 * `onnxruntime-node` is a native module, so option 2 needs a VPS or container. On a
 * runtime that cannot load native addons, set the URL and use option 1.
 */
export async function resolveRadiologyClassifier(): Promise<RadiologyClassifier> {
  if (cached) return cached;

  const url = process.env.RADIOLOGY_CLASSIFIER_URL?.trim();
  if (url && huggingFaceApiKey()) {
    const modelId =
      process.env.RADIOLOGY_CLASSIFIER_MODEL?.trim() ||
      'torchxrayvision/densenet121-res224-all';
    cached = new HuggingFaceClassifier(modelId, url);
    return cached;
  }

  if (process.env.RADIOLOGY_DISABLE_LOCAL_MODEL !== '1') {
    try {
      const { isOnnxModelAvailable, OnnxRadiologyClassifier } = await import(
        './onnx-classifier'
      );
      if (await isOnnxModelAvailable()) {
        cached = new OnnxRadiologyClassifier();
        return cached;
      }
    } catch (error) {
      // Native module missing or unloadable on this runtime — fall through and say so.
      console.warn(
        '[Radiology] local ONNX backend unavailable:',
        error instanceof Error ? error.message : error
      );
    }
  }

  cached = new NullClassifier();
  return cached;
}

/** Test seam. */
export function resetRadiologyClassifier(): void {
  cached = null;
}
