import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { detectRadiograph } from './detect-radiograph';

/**
 * Guards the fix for X-rays never being screened: analysis only ran when the user set
 * the document type to "Imaging Report", but the upload form defaults to "Other", so
 * an uploaded chest X-ray just had its burned-in study label read back by OCR.
 *
 * Thresholds were calibrated against a real phone photo of a chest film and a real
 * photographed prescription, so these fixtures reproduce their tone profiles:
 *
 *                    mean    very dark
 *   chest X-ray      90.9      18.8%
 *   prescription    179.5       0.5%
 */

/** A dark field with a brighter centre — the tone profile of a film on a lightbox. */
async function radiographLike(): Promise<Buffer> {
  const size = 256;
  const pixels = Buffer.alloc(size * size);
  const centre = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const r = Math.sqrt(dx * dx + dy * dy);
      // Bright anatomy in the middle third, near-black surround beyond it.
      pixels[y * size + x] = r < 0.55 ? 150 + Math.round(60 * (1 - r)) : 15;
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 1 } }).png().toBuffer();
}

/** A bright page with dark text lines. */
async function documentLike(): Promise<Buffer> {
  const size = 256;
  const pixels = Buffer.alloc(size * size, 245);
  for (let line = 20; line < size; line += 24) {
    for (let y = line; y < line + 4 && y < size; y += 1) {
      for (let x = 15; x < size - 15; x += 1) pixels[y * size + x] = 30;
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 1 } }).png().toBuffer();
}

describe('detectRadiograph', () => {
  it('recognises a radiograph tone profile', async () => {
    const result = await detectRadiograph(await radiographLike());
    expect(result.isRadiograph).toBe(true);
    expect(result.stats.meanBrightness).toBeLessThan(140);
    expect(result.stats.darkFraction).toBeGreaterThan(0.05);
  });

  it('does not mistake a photographed document for a radiograph', async () => {
    // The costly error: a misjudged prescription must never lose its medications.
    const result = await detectRadiograph(await documentLike());
    expect(result.isRadiograph).toBe(false);
    expect(result.stats.meanBrightness).toBeGreaterThan(140);
  });

  it('does not rely on the image being greyscale', async () => {
    // The obvious heuristic fails on real uploads: a phone photo of a film on a
    // lightbox carries a strong colour cast and measured *more* chromatic than the
    // prescription it had to be told apart from.
    const tinted = await sharp(await radiographLike())
      .toColourspace('srgb')
      .tint({ r: 200, g: 220, b: 255 })
      .png()
      .toBuffer();
    expect((await detectRadiograph(tinted)).isRadiograph).toBe(true);
  });

  it('rejects a blank white page', async () => {
    const white = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 250, g: 250, b: 248 } },
    })
      .png()
      .toBuffer();
    expect((await detectRadiograph(white)).isRadiograph).toBe(false);
  });

  it('returns false rather than throwing on an unreadable file', async () => {
    // Detection failing must never fail an upload.
    const result = await detectRadiograph(Buffer.from('not an image at all'));
    expect(result.isRadiograph).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('reports zero confidence when it says no', async () => {
    expect((await detectRadiograph(await documentLike())).confidence).toBe(0);
  });
});
