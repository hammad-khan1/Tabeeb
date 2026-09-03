import { config } from 'dotenv';
config({ path: '.env.local' });

import { readFileSync } from 'node:fs';
import { groq, MODELS } from '@/lib/groq';
import { normalizeForVision } from '@/services/text-extractors/image-normalizer';
import { ocrImage } from '@/services/text-extractors/image-extractor';

// Verbatim copy of OCR_SYSTEM_PROMPT from image-extractor.ts so the single-pass baseline is
// exactly what the first pass of ocrImage sends.
const OCR_SYSTEM_PROMPT = `You are a medical document OCR specialist working with Pakistani health records. Extract ALL text from the provided image with maximum fidelity.

Rules:
- Extract every visible character, including Urdu script (preserve the original script, never transliterate)
- Preserve the layout structure: headings, tables, lists, and spacing as closely as possible
- For tables, use pipe-delimited rows: | col1 | col2 | col3 |
- Include headers, footers, stamps, signatures, and watermark text
- Read handwriting carefully. Pakistani prescriptions commonly use these abbreviations: OD (once daily), BD/BID (twice daily), TDS/TID (three times daily), QID (four times daily), HS (at night), SOS/PRN (as needed), stat (immediately), PO (by mouth), and the dosage forms Tab, Cap, Syp, Inj, Susp. Transcribe them exactly as written — do not expand or normalize them.
- Never guess a drug name, dose, or lab value. If a character or number is uncertain, transcribe your best reading and append [unclear: what you see] immediately after it
- Do not skip a line because it is hard to read — transcribe what you can and mark the remainder [unclear]
- Do not summarize, translate, correct, or add anything that is not visibly present

Respond in this exact JSON format:
{
  "extractedText": "all extracted text here",
  "confidence": <number 0-100 estimating OCR accuracy>,
  "isHandwritten": <boolean - true if the majority of content is handwritten>
}`;

const FULL_FACTS = [
  'Metformin',
  '850',
  'Amlodipine',
  'Omeprazole',
  'Atorvastatin',
  '8.4',
  '178',
  'Penicillin',
  'Imran',
  'Siddiqui',
  'Hypertension',
  'Diabetes',
];

// The hard fixture is a crop of only the Rx + investigations block.
const CROP_FACTS = [
  'Metformin',
  '850',
  'Amlodipine',
  'Omeprazole',
  'Atorvastatin',
  '8.4',
  '178',
];

let FACTS = FULL_FACTS;

function recall(text: string): { hits: string[]; misses: string[] } {
  const haystack = text.toLowerCase();
  const hits: string[] = [];
  const misses: string[] = [];
  for (const fact of FACTS) {
    if (haystack.includes(fact.toLowerCase())) hits.push(fact);
    else misses.push(fact);
  }
  return { hits, misses };
}

async function singlePass(buffer: Buffer, mimeType: string) {
  const image = await normalizeForVision(buffer, mimeType);
  const dataUrl = `data:${image.mimeType};base64,${image.buffer.toString('base64')}`;
  const response = await groq.chat.completions.create({
    model: MODELS.vision,
    messages: [
      { role: 'system', content: OCR_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'text', text: 'Extract all text from this medical document image.' },
        ],
      },
    ],
    temperature: 0.1,
    max_tokens: 8192,
    response_format: { type: 'json_object' },
  });
  const raw = response.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(raw) as {
    extractedText?: string;
    confidence?: number;
    isHandwritten?: boolean;
  };
  return {
    text: parsed.extractedText ?? '',
    confidence: parsed.confidence ?? 0,
    isHandwritten: parsed.isHandwritten === true,
  };
}

async function main() {
  const path = process.argv[2] ?? '.tmp-probe/faint-rx.jpg';
  if (path.includes('hard')) FACTS = CROP_FACTS;
  const buffer = readFileSync(path);
  console.log(`fixture: ${path} (${(buffer.length / 1024).toFixed(0)} KB)\n`);

  const t1 = Date.now();
  const one = await singlePass(buffer, 'image/jpeg');
  const oneMs = Date.now() - t1;
  const oneRecall = recall(one.text);

  console.log('--- SINGLE PASS ---');
  console.log(
    `${oneMs}ms | chars ${one.text.length} | confidence ${one.confidence} | handwritten ${one.isHandwritten}`
  );
  console.log(`recall ${oneRecall.hits.length}/${FACTS.length}  missed: ${oneRecall.misses.join(', ') || 'none'}`);
  console.log(one.text);

  const t2 = Date.now();
  const two = await ocrImage(buffer, 'image/jpeg');
  const twoMs = Date.now() - t2;
  const twoRecall = recall(two.text);

  console.log('\n--- TWO PASS (ocrImage) ---');
  console.log(
    `${twoMs}ms | chars ${two.text.length} | confidence ${two.confidence} | handwritten ${two.isHandwritten}`
  );
  console.log(`recall ${twoRecall.hits.length}/${FACTS.length}  missed: ${twoRecall.misses.join(', ') || 'none'}`);
  console.log(two.text);

  console.log('\n--- DELTA ---');
  console.log(`chars  ${one.text.length} -> ${two.text.length} (${two.text.length - one.text.length >= 0 ? '+' : ''}${two.text.length - one.text.length})`);
  console.log(`recall ${oneRecall.hits.length} -> ${twoRecall.hits.length}`);
  console.log(`latency ${oneMs}ms -> ${twoMs}ms`);
  const recovered = oneRecall.misses.filter((m) => twoRecall.hits.includes(m));
  const lost = twoRecall.misses.filter((m) => oneRecall.hits.includes(m));
  console.log(`recovered by pass 2: ${recovered.join(', ') || 'none'}`);
  console.log(`lost by pass 2: ${lost.join(', ') || 'none'}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
