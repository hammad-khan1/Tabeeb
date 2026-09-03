import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const HAND = "'Bradley Hand', 'Chalkduster', cursive";
const INK = '#2b3a67';

// Uneven baselines + slight per-line rotation, the way a real hand drifts down the page.
const lines = [
  ['Patient: Muhammad Imran        Age: 54 / M', 0],
  ['Date: 12 / 08 / 2026', 0.4],
  ['', 0],
  ['Dx:  Type 2 Diabetes Mellitus', -0.5],
  ['      c/o Hypertension', 0.3],
  ['', 0],
  ['Rx', 0],
  ['1)  Tab. Metformin  850 mg      BD  x 30 days', 0.5],
  ['2)  Tab. Amlodipine  5 mg        OD  x 30 days', -0.4],
  ['3)  Cap. Omeprazole 20 mg      OD  a.c.', 0.6],
  ['4)  Tab. Atorvastatin 20 mg     HS', -0.3],
  ['', 0],
  ['Investigations:', 0],
  ['      HbA1c  =  8.4 %', 0.4],
  ['      FBS    =  178 mg/dL', -0.5],
  ['      S. Creatinine = 1.1 mg/dL', 0.2],
  ['', 0],
  ['Allergy: PENICILLIN', -0.6],
  ['', 0],
  ['Advice: Low salt diet, walk 30 min daily', 0.3],
  ['Review after 4 weeks with reports', -0.2],
];

let y = 250;
const body = lines
  .map(([text, dx]) => {
    if (!text) { y += 26; return ''; }
    const rot = (Math.random() - 0.5) * 1.1;
    const el = `<text x="${90 + dx * 6}" y="${y}" font-family="${HAND}" font-size="30" fill="${INK}" transform="rotate(${rot.toFixed(2)} ${90 + dx * 6} ${y})">${text.replace(/&/g, '&amp;')}</text>`;
    y += 52;
    return el;
  })
  .join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="${y + 220}">
  <rect width="100%" height="100%" fill="#fdfcf7"/>
  <text x="90" y="80" font-family="Helvetica" font-size="38" font-weight="bold" fill="#1a1a1a">SHIFA CLINIC</text>
  <text x="90" y="115" font-family="Helvetica" font-size="20" fill="#444">Dr. Ayesha Siddiqui — MBBS, FCPS (Medicine)</text>
  <text x="90" y="142" font-family="Helvetica" font-size="18" fill="#666">Jail Road, Lahore   |   Ph: 042-3577xxxx</text>
  <line x1="90" y1="170" x2="1150" y2="170" stroke="#999" stroke-width="2"/>
  ${body}
  <text x="820" y="${y + 130}" font-family="${HAND}" font-size="30" fill="${INK}" transform="rotate(-3 820 ${y + 130})">A. Siddiqui</text>
  <line x1="800" y1="${y + 150}" x2="1080" y2="${y + 150}" stroke="#555" stroke-width="1"/>
  <text x="840" y="${y + 178}" font-family="Helvetica" font-size="17" fill="#666">Signature &amp; Stamp</text>
</svg>`;

writeFileSync('.tmp-probe/hand.svg', svg);

// Degrade it into something like a hurried phone photo: soft focus, warm cast, JPEG artifacts.
const png = await sharp(Buffer.from(svg)).png().toBuffer();
await sharp(png)
  .rotate(0.7, { background: '#fdfcf7' })
  .blur(0.7)
  .modulate({ brightness: 0.95, saturation: 0.9 })
  .jpeg({ quality: 62 })
  .toFile('.tmp-probe/handwritten-rx.jpg');

const meta = await sharp('.tmp-probe/handwritten-rx.jpg').metadata();
console.log('fixture:', meta.width + 'x' + meta.height, meta.format);
