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
 * the X-ray was *more* chromatic than the prescription (chroma 17.5 vs 12.7).
 *
 * Measured across all three kinds of image that turn up:
 *
 *                              mean    very dark   very light
 *   digital radiograph        112.8       3.1%        0.7%
 *   phone photo of a film      98.5      18.8%        6.4%
 *   photographed prescription 174.5       0.5%       21.1%
 *
 * Brightness and the blown-out-white fraction separate radiographs from documents
 * cleanly. The dark fraction needs care: a properly windowed radiograph fills the
 * frame with anatomy and has almost no black surround, so a threshold calibrated on
 * the phone photo (whose black comes from the room around the lightbox) rejected
 * genuine X-ray files. It sits low enough to admit both.
 *
 * A positive result only ever *adds* the classifier pass; it never suppresses text
 * extraction. A document wrongly judged a radiograph would otherwise lose its
 * medications, while a radiograph wrongly judged a document costs only a redundant
 * OCR — that asymmetry sets the thresholds' direction.
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

/**
 * Some genuinely black pixels, which paper under even lighting does not produce.
 * Deliberately low: a digital radiograph measured 3.1% and a photographed
 * prescription 0.5%, so the useful line is well below the phone photo's 18.8%.
 */
const MIN_DARK_FRACTION = 0.015;

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
