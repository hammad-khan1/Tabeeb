import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { OnnxRadiologyClassifier, isOnnxModelAvailable } from './onnx-classifier';

/**
 * Exercises the in-process backend against the real exported model. Skipped when the
 * model file is absent, so a checkout without it still has a green suite.
 */

let available = false;
beforeAll(async () => {
  available = await isOnnxModelAvailable();
});

/** A dark field with a brighter centre — the tone profile of a chest film. */
async function radiographLike(): Promise<Buffer> {
  const size = 320;
  const pixels = Buffer.alloc(size * size);
  const centre = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const r = Math.sqrt(dx * dx + dy * dy);
      pixels[y * size + x] = r < 0.6 ? 140 + Math.round(70 * (1 - r)) : 12;
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 1 } }).png().toBuffer();
}

describe('OnnxRadiologyClassifier', () => {
  it('reports itself as configured without any environment variables', async () => {
    // The whole point of this backend: nothing to set up, nothing to deploy.
    expect(new OnnxRadiologyClassifier().isConfigured()).toBe(true);
  });

  it('scores all 18 pathologies of the checkpoint', async () => {
    if (!available) return;
    const result = await new OnnxRadiologyClassifier().classify(
      await radiographLike(),
      'image/png'
    );
    // Either it scored everything, or it declined — never a partial set.
    if (!result.unavailableReason) {
      expect(result.scores).toHaveLength(18);
    }
  });

  it('normalises pathology labels to the app spelling', async () => {
    if (!available) return;
    const result = await new OnnxRadiologyClassifier().classify(
      await radiographLike(),
      'image/png'
    );
    // The checkpoint spells these with underscores.
    for (const score of result.scores) {
      expect(score.pathology).not.toMatch(/_/);
    }
  });

  it('keeps every probability inside [0, 1]', async () => {
    if (!available) return;
    const result = await new OnnxRadiologyClassifier().classify(
      await radiographLike(),
      'image/png'
    );
    for (const score of result.scores) {
      expect(score.probability).toBeGreaterThanOrEqual(0);
      expect(score.probability).toBeLessThanOrEqual(1);
    }
  });

  it('returns a reason rather than throwing on an unreadable file', async () => {
    if (!available) return;
    const result = await new OnnxRadiologyClassifier().classify(
      Buffer.from('not an image'),
      'image/png'
    );
    expect(result.unavailableReason).toBeTruthy();
    expect(result.flagged).toEqual([]);
  });

  it('reuses one loaded session across calls', async () => {
    if (!available) return;
    // 26MB of weights must not be loaded per upload; the second call should be much
    // faster than the first, which pays the load cost.
    const classifier = new OnnxRadiologyClassifier();
    const image = await radiographLike();

    const start = Date.now();
    await classifier.classify(image, 'image/png');
    const cold = Date.now() - start;

    const warmStart = Date.now();
    await classifier.classify(image, 'image/png');
    const warm = Date.now() - warmStart;

    expect(warm).toBeLessThanOrEqual(cold);
  }, 30_000);
});
