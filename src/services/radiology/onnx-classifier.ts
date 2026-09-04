import { readFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import type * as Ort from 'onnxruntime-node';
import type {
  ClassificationResult,
  Pathology,
  PathologyScore,
  RadiologyClassifier,
} from './classifier';

/**
 * Runs the chest X-ray model in-process, with no separate service to deploy.
 *
 * The model is torchxrayvision's densenet121-res224-all exported to ONNX (see
 * services/xray-classifier/export_onnx.py). Inference is ~30ms on CPU, so the network
 * hop and the cold-start problem of a hosted endpoint both disappear — and the image
 * never leaves the server, which for X-rays is the point.
 *
 * `onnxruntime-node` is a native module: this runs on a VPS or in a container, not on
 * a serverless runtime that cannot load native addons. Where that matters, the HTTP
 * backend in classifier.ts remains available.
 */

const MODEL_DIR = path.join(process.cwd(), 'models');
const MODEL_PATH = path.join(MODEL_DIR, 'chest-xray-densenet121.onnx');
const META_PATH = path.join(MODEL_DIR, 'chest-xray-densenet121.meta.json');

/** The model's input geometry — fixed at export time. */
const INPUT_SIZE = 224;

/**
 * Sharp's default (lanczos3) diverges noticeably from the skimage resize the model was
 * calibrated with — measured against the Python reference, peak drift was 0.226 across
 * pathologies. `mitchell` brings that to 0.023, which is below the width of any
 * decision this feature makes and far below the confirm-with-a-doctor framing every
 * result carries.
 */
const RESIZE_KERNEL = 'mitchell' as const;

interface ModelMeta {
  model: string;
  pathologies: string[];
  op_threshs: (number | null)[];
}

/**
 * torchxrayvision's preprocessing, reproduced exactly:
 *   grey   = mean of R,G,B — NOT the luminance formula, which sharp would apply
 *   crop   = centre square on the shorter side
 *   resize = 224x224
 *   scale  = (2*(v/255) - 1) * 1024, i.e. roughly [-1024, 1024]
 */
async function preprocess(image: Buffer): Promise<Float32Array> {
  const meta = await sharp(image).metadata();
  const width = meta.width;
  const height = meta.height;
  if (!width || !height) throw new Error('Image has no readable dimensions');

  const side = Math.min(width, height);
  const { data, info } = await sharp(image)
    .extract({
      left: Math.floor(width / 2 - side / 2),
      top: Math.floor(height / 2 - side / 2),
      width: side,
      height: side,
    })
    .resize(INPUT_SIZE, INPUT_SIZE, { fit: 'fill', kernel: RESIZE_KERNEL })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Float32Array(INPUT_SIZE * INPUT_SIZE);
  const channels = info.channels;
  for (let i = 0; i < pixels.length; i += 1) {
    const offset = i * channels;
    const grey =
      channels >= 3
        ? (data[offset] + data[offset + 1] + data[offset + 2]) / 3
        : data[offset];
    pixels[i] = (2 * (grey / 255) - 1) * 1024;
  }
  return pixels;
}

/**
 * op_norm, from the reference implementation. It rescales each raw sigmoid about that
 * pathology's calibrated operating point, so the returned 0.5 means "exactly at the
 * threshold" rather than "50% likely" — which is why an image the model cannot read
 * comes back clustered around 0.5 on every label.
 *
 * Excluded from the ONNX graph because its boolean-mask assignment does not export.
 */
function applyOperatingPoints(
  sigmoid: Float32Array,
  thresholds: (number | null)[]
): number[] {
  return Array.from(sigmoid, (value, index) => {
    const threshold = thresholds[index];
    if (threshold === null || !Number.isFinite(threshold)) return 0.5;
    return value < threshold
      ? value / (threshold * 2)
      : 1 - (1 - value) / ((1 - threshold) * 2);
  });
}

export class OnnxRadiologyClassifier implements RadiologyClassifier {
  readonly modelId = 'torchxrayvision/densenet121-res224-all (onnx, in-process)';

  private session: Ort.InferenceSession | null = null;
  private meta: ModelMeta | null = null;
  private loading: Promise<void> | null = null;

  isConfigured(): boolean {
    return true;
  }

  /** Loaded once and shared; concurrent uploads must not each load 26MB. */
  private async load(): Promise<void> {
    if (this.session && this.meta) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const ort = await import('onnxruntime-node');
      const [session, metaRaw] = await Promise.all([
        ort.InferenceSession.create(MODEL_PATH),
        readFile(META_PATH, 'utf8'),
      ]);
      this.session = session;
      this.meta = JSON.parse(metaRaw) as ModelMeta;
    })();

    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  // mimeType is part of the RadiologyClassifier contract and used by the HTTP
  // backend; sharp sniffs the format from the bytes, so it is unused here.
  async classify(image: Buffer, _mimeType: string): Promise<ClassificationResult> {
    const { isDiscriminating, selectFlagged } = await import('./classifier');

    try {
      await this.load();
    } catch (error) {
      return this.unavailable(
        `The X-ray model could not be loaded: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    }

    const session = this.session;
    const meta = this.meta;
    if (!session || !meta) return this.unavailable('The X-ray model is not loaded.');

    let scores: PathologyScore[];
    try {
      const ort = await import('onnxruntime-node');
      const input = await preprocess(image);
      const output = await session.run({
        image: new ort.Tensor('float32', input, [1, 1, INPUT_SIZE, INPUT_SIZE]),
      });

      const normalized = applyOperatingPoints(
        output.sigmoid.data as Float32Array,
        meta.op_threshs
      );

      scores = meta.pathologies
        .map((pathology, index) => ({
          // The checkpoint spells this with an underscore; the app's type does not.
          pathology: pathology.replace(/_/g, ' ') as Pathology,
          probability: Math.min(1, Math.max(0, normalized[index])),
        }))
        .filter((score) => Number.isFinite(score.probability));
    } catch (error) {
      return this.unavailable(
        `This image could not be analysed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    }

    scores.sort((a, b) => b.probability - a.probability);

    // A photographed film is the common upload and the model cannot read it; its
    // undiscriminating output must not be reported as findings.
    if (!isDiscriminating(scores)) {
      return {
        scores,
        flagged: [],
        modelId: this.modelId,
        unavailableReason:
          'The screening model could not read this image reliably — its results were no better than guessing. This usually means it is a photograph of an X-ray on a screen or lightbox rather than the X-ray file itself. Ask the hospital for the digital image, or photograph the film straight-on, filling the frame, with no glare.',
      };
    }

    return { scores, flagged: selectFlagged(scores), modelId: this.modelId };
  }

  private unavailable(reason: string): ClassificationResult {
    return { scores: [], flagged: [], modelId: this.modelId, unavailableReason: reason };
  }
}

/** Whether the exported model is present, so the backend can be selected. */
export async function isOnnxModelAvailable(): Promise<boolean> {
  try {
    await readFile(META_PATH, 'utf8');
    return true;
  } catch {
    return false;
  }
}
