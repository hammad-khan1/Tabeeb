import sharp, { type Metadata } from 'sharp';

const VISION_NATIVE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_VISION_DIMENSION = 2400;
const JPEG_QUALITY = 92;

export interface NormalizedImage {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Vision models only accept jpeg/png/webp, so HEIC (iPhone default), TIFF and GIF
 * must be transcoded before upload. Also applies EXIF rotation and flattens alpha —
 * a transparent scan flattened to black by the model would read as a blank page.
 */
export async function normalizeForVision(
  buffer: Buffer,
  mimeType: string
): Promise<NormalizedImage> {
  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, { failOn: 'none' }).metadata();
  } catch {
    if (VISION_NATIVE_MIMES.has(mimeType)) {
      return { buffer, mimeType };
    }
    throw new Error(`Unreadable or unsupported image format: ${mimeType}`);
  }

  const largestSide = Math.max(metadata.width ?? 0, metadata.height ?? 0);
  const needsTranscode = !VISION_NATIVE_MIMES.has(mimeType);
  const needsDownscale = largestSide > MAX_VISION_DIMENSION;
  const hasAlpha = metadata.hasAlpha ?? false;
  const needsRotation = (metadata.orientation ?? 1) !== 1;

  if (!needsTranscode && !needsDownscale && !hasAlpha && !needsRotation) {
    return { buffer, mimeType };
  }

  let pipeline = sharp(buffer, { failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' });

  if (needsDownscale) {
    pipeline = pipeline.resize({
      width: MAX_VISION_DIMENSION,
      height: MAX_VISION_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  return {
    buffer: await pipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer(),
    mimeType: 'image/jpeg',
  };
}

/** Below this, a handwriting scan is too small for the model to resolve individual strokes. */
const MIN_HANDWRITING_DIMENSION = 1600;

/**
 * Produces a deliberately different read of the same page for a second OCR pass: faint
 * ballpoint on a phone photo is the usual reason handwriting comes back half-transcribed, and
 * histogram normalization plus sharpening recovers strokes the first pass missed.
 */
export async function enhanceForHandwriting(
  buffer: Buffer,
  mimeType: string
): Promise<NormalizedImage> {
  const base = await normalizeForVision(buffer, mimeType);

  try {
    const metadata = await sharp(base.buffer, { failOn: 'none' }).metadata();
    const largestSide = Math.max(metadata.width ?? 0, metadata.height ?? 0);

    let pipeline = sharp(base.buffer, { failOn: 'none' }).grayscale().normalize();

    if (largestSide > 0 && largestSide < MIN_HANDWRITING_DIMENSION) {
      const scale = MIN_HANDWRITING_DIMENSION / largestSide;
      pipeline = pipeline.resize({
        width: Math.round((metadata.width ?? largestSide) * scale),
        kernel: 'lanczos3',
      });
    }

    return {
      buffer: await pipeline.sharpen({ sigma: 1.2 }).jpeg({ quality: JPEG_QUALITY }).toBuffer(),
      mimeType: 'image/jpeg',
    };
  } catch {
    return base;
  }
}
