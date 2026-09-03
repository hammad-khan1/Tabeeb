import sharp from 'sharp';
import { readFileSync } from 'node:fs';

// A small, heavily degraded crop of just the Rx + investigations block. Downscaling below the
// legibility threshold is the only thing that actually defeats the vision model on a synthetic
// fixture, and a small image also keeps both OCR passes inside the per-minute token budget.
const svg = readFileSync('.tmp-probe/hand.svg', 'utf8').replace(/#2b3a67/g, '#9aa0ad');
const base = await sharp(Buffer.from(svg)).png().toBuffer();

await sharp(base)
  .extract({ left: 60, top: 480, width: 860, height: 500 })
  .resize({ width: 360, kernel: 'lanczos3' })
  .rotate(1.1, { background: '#e8e6df' })
  .blur(0.9)
  .modulate({ brightness: 0.9 })
  .linear(0.7, 40)
  .jpeg({ quality: 22 })
  .toFile('.tmp-probe/hard-rx.jpg');

const meta = await sharp('.tmp-probe/hard-rx.jpg').metadata();
console.log(`hard fixture: ${meta.width}x${meta.height}`);
