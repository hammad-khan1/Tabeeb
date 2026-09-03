import { config } from 'dotenv';
config({ path: '.env.local' });
import { readFileSync } from 'node:fs';
import { extractText } from '@/services/text-extractors';
import { extractStructuredData } from '@/services/document-processor';
import { reconcileExtraction } from '@/services/nlp/reconciler';
import { generateDocumentSummary } from '@/services/summarizer';

const buffer = readFileSync('.tmp-probe/handwritten-rx.jpg');

console.log('── 1. OCR (two-pass) ─────────────────────────');
let t = Date.now();
const extraction = await extractText(buffer, 'image/jpeg', 'prescription');
console.log(`took ${((Date.now() - t) / 1000).toFixed(1)}s`);
console.log('isHandwritten:', extraction.isHandwritten, '| confidence:', extraction.confidence, '| chars:', extraction.text.length);
console.log('─'.repeat(46));
console.log(extraction.text);

console.log('\n── 2. Structured extraction ─────────────────');
t = Date.now();
const raw = await extractStructuredData(extraction.text, 'prescription');
console.log(`took ${((Date.now() - t) / 1000).toFixed(1)}s`);
console.log('meds:', raw.medications.length, '| dx:', raw.diagnoses.length, '| labs:', raw.labResults.length, '| allergies:', raw.allergies.length);

console.log('\n── 3. NLP reconciliation (RxNorm + NER) ─────');
t = Date.now();
const rec = await reconcileExtraction(extraction.text, raw);
console.log(`took ${((Date.now() - t) / 1000).toFixed(1)}s`);
for (const m of rec.extraction.medications) {
  console.log(`  ${(m.name ?? '?').padEnd(16)} ${(m.dosage ?? '').padEnd(9)} ${(m.frequency ?? '').padEnd(6)} rxcui=${m.rxnormId ?? '-'}`);
}
console.log('corrections:', rec.correctedDrugCount, '| flagged misses:', rec.missedEntities.map((e) => e.text).join(', ') || 'none');
for (const n of rec.notes) console.log('  NOTE:', n);

console.log('\n── 4. Patient-language summary ──────────────');
t = Date.now();
const summary = await generateDocumentSummary({
  text: extraction.text,
  extraction: rec.extraction,
  documentType: 'prescription',
  language: rec.extraction.language ?? 'mixed',
  isHandwritten: extraction.isHandwritten ?? false,
  confidence: extraction.confidence ?? null,
});
console.log(`took ${((Date.now() - t) / 1000).toFixed(1)}s\n`);
console.log(summary);

console.log('\n── 5. Key-fact recall ───────────────────────');
const facts = ['Metformin','850','Amlodipine','Omeprazole','Atorvastatin','8.4','178','Penicillin','Imran','Siddiqui','Hypertension','Diabetes'];
const hay = (extraction.text + JSON.stringify(rec.extraction)).toLowerCase();
let hits = 0;
for (const f of facts) {
  const ok = hay.includes(f.toLowerCase());
  if (ok) hits++;
  console.log(`  ${ok ? 'OK  ' : 'MISS'} ${f}`);
}
console.log(`\nrecall: ${hits}/${facts.length}`);
