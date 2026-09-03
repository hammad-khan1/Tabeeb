import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

// Same prescription, but faint pencil-grey ink on a dim, unevenly-lit phone photo:
// the case that was coming back half-transcribed.
const svg = readFileSync('.tmp-probe/hand.svg', 'utf8').replace(/#2b3a67/g, '#8e94a3');
writeFileSync('.tmp-probe/faint.svg', svg);

const base = await sharp(Buffer.from(svg)).png().toBuffer();
const { width, height } = await sharp(base).metadata();

// Diagonal shadow gradient, like a hand blocking the light.
const shade = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
     <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
       <stop offset="0%" stop-color="#000" stop-opacity="0.02"/>
       <stop offset="100%" stop-color="#000" stop-opacity="0.42"/>
     </linearGradient></defs>
     <rect width="100%" height="100%" fill="url(#g)"/>
   </svg>`
);

await sharp(base)
  .composite([{ input: shade, blend: 'over' }])
  .rotate(1.4, { background: '#e8e6df' })
  .blur(1.6)
  .modulate({ brightness: 0.82, saturation: 0.75 })
  .linear(0.82, 18)
  .jpeg({ quality: 38 })
  .toFile('.tmp-probe/faint-rx.jpg');

console.log('faint fixture:', (await sharp('.tmp-probe/faint-rx.jpg').metadata()).width + 'px');
