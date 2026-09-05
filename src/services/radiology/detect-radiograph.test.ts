import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { detectRadiograph } from './detect-radiograph';
import { buildResolutionNote, CAPTURE_GUIDANCE } from './validator';

/**
 * The resolution check exists because every X-ray this app has received arrived via
 * WhatsApp at 720px on the long edge — roughly a tenth of what the phone's camera
 * captured, and far below the 1440x1440 a cleared product like qXR requires.
 */

/** A dark field with a brighter centre: the tone profile of a radiograph. */
async function radiographLike(size: number): Promise<Buffer> {
  const pixels = Buffer.alloc(size * size);
  const centre = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      pixels[y * size + x] = Math.sqrt(dx * dx + dy * dy) < 0.6 ? 170 : 10;
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 1 } }).png().toBuffer();
}

describe('resolution assessment', () => {
  it('flags a WhatsApp-sized radiograph as too small', async () => {
    const result = await detectRadiograph(await radiographLike(720));
    expect(result.isRadiograph).toBe(true);
    expect(result.belowUsefulResolution).toBe(true);
    expect(result.stats.width).toBe(720);
  });

  it('accepts a full-resolution capture', async () => {
    const result = await detectRadiograph(await radiographLike(1600));
    expect(result.isRadiograph).toBe(true);
    expect(result.belowUsefulResolution).toBe(false);
  });

  it('reports dimensions so the patient can be told the actual number', async () => {
    const result = await detectRadiograph(await radiographLike(900));
    expect(result.stats.width).toBe(900);
    expect(result.stats.height).toBe(900);
  });

  it('does not flag resolution on something that is not a radiograph', async () => {
    // A small bright image is a document thumbnail, not an X-ray to re-photograph.
    const page = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 250, g: 250, b: 248 } },
    }).png().toBuffer();

    const result = await detectRadiograph(page);
    expect(result.isRadiograph).toBe(false);
    expect(result.belowUsefulResolution).toBe(false);
  });
});

describe('buildResolutionNote', () => {
  it('states the actual size rather than a vague complaint', () => {
    expect(buildResolutionNote(720, 1280)).toMatch(/720×1280/);
  });

  it('carries the capture protocol, including the WhatsApp warning', () => {
    const note = buildResolutionNote(720, 1280);
    expect(note).toMatch(/lightbox/i);
    expect(note).toMatch(/flash off/i);
    expect(note).toMatch(/WhatsApp/i);
    expect(CAPTURE_GUIDANCE).toMatch(/parallel/i);
  });
});
