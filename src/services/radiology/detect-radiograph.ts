import sharp from 'sharp';

/**
 * Decides whether an uploaded image is a radiograph rather than a photographed
 * document.
 *
 * Why this exists: X-ray screening only ran when the user set the document type to
 * "Imaging Report", but the upload form defaults to "Other" and nobody changes it. A
 * patient uploading a chest X-ray got the film's burned-in study label read back by
 * OCR — "2026/05/19 MMC Mardan" — and a note saying no medical entities were found.
 * Behaviour that depends on a dropdown the user never touches is behaviour that never
 * happens.
 *
 * The discriminator is tone, not colour. The obvious guess — that a radiograph is
 * greyscale — is wrong for the images this app actually receives: a phone photo of a
 * film on a lightbox carries a strong colour cast, and measured against real uploads
 * the X-ray was *more* chromatic than the prescription (chroma 17.5 vs 12.7). What
 * separates them cleanly is that a document is mostly bright paper and a radiograph is
 * mostly dark surround:
 *
 *                    mean    very dark   very light
 *   chest X-ray      90.9      18.8%        6.4%
 *   prescription    179.5       0.5%       21.1%
 *
 * Calibrated on a small sample, so the thresholds sit near the midpoints with wide
 * margins, and — importantly — a positive result only ever *adds* the classifier pass.
 * It never suppresses text extraction, because a document wrongly judged a radiograph
 * would otherwise lose its medications, while a radiograph wrongly judged a document
 * costs only a redundant OCR.
 */

export interface RadiographDetection {
  isRadiograph: boolean;
  /** 0-1, how strongly the tone profile matches. */
  confidence: number;
  stats: {
    meanBrightness: number;
    darkFraction: number;
    lightFraction: number;
  };
}

/** Below this an image is "mostly dark"; paper documents sit far above it. */
const MAX_MEAN_BRIGHTNESS = 140;

/** A radiograph has a substantial black surround outside the anatomy. */
const MIN_DARK_FRACTION = 0.05;

/** Paper blows out to white over large areas; a film does not. */
const MAX_LIGHT_FRACTION = 0.15;

const DARK_LEVEL = 40;
const LIGHT_LEVEL = 205;

/** Small enough to be fast, large enough for the tone distribution to be stable. */
const SAMPLE_SIZE = 128;

export async function detectRadiograph(buffer: Buffer): Promise<RadiographDetection> {
  const fallback: RadiographDetection = {
    isRadiograph: false,
    confidence: 0,
    stats: { meanBrightness: 0, darkFraction: 0, lightFraction: 0 },
  };

  try {
    const pixels = await sharp(buffer)
      .greyscale()
      .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'fill' })
      .raw()
      .toBuffer();

    if (pixels.length === 0) return fallback;

    let total = 0;
    let dark = 0;
    let light = 0;
    for (const value of pixels) {
      total += value;
      if (value < DARK_LEVEL) dark += 1;
      else if (value > LIGHT_LEVEL) light += 1;
    }

    const meanBrightness = total / pixels.length;
    const darkFraction = dark / pixels.length;
    const lightFraction = light / pixels.length;

    const isRadiograph =
      meanBrightness < MAX_MEAN_BRIGHTNESS &&
      darkFraction > MIN_DARK_FRACTION &&
      lightFraction < MAX_LIGHT_FRACTION;

    // Distance past each threshold, averaged — used only for logging and the note
    // shown to the user, never to gate anything.
    const confidence = isRadiograph
      ? Math.min(
          1,
          ((MAX_MEAN_BRIGHTNESS - meanBrightness) / MAX_MEAN_BRIGHTNESS +
            Math.min(darkFraction / 0.25, 1) +
            (MAX_LIGHT_FRACTION - lightFraction) / MAX_LIGHT_FRACTION) /
            3
        )
      : 0;

    return {
      isRadiograph,
      confidence,
      stats: { meanBrightness, darkFraction, lightFraction },
    };
  } catch {
    // An unreadable image is handled downstream; detection failing must not fail
    // the upload.
    return fallback;
  }
}
