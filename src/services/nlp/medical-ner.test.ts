import { describe, it, expect } from 'vitest';
import { extractEntitiesByRules } from './medical-ner';
import { stripDrugNameNoise } from './drug-normalizer';

describe('stripDrugNameNoise', () => {
  it('reduces a prescription line to the ingredient name', () => {
    expect(stripDrugNameNoise('Tab. Metformin 850mg BD')).toBe('Metformin');
    expect(stripDrugNameNoise('Cap Omeprazole 20 mg OD')).toBe('Omeprazole');
    expect(stripDrugNameNoise('Syp. Augmentin 5ml TDS')).toBe('Augmentin');
  });

  it('drops OCR uncertainty markers so they do not defeat the lookup', () => {
    expect(stripDrugNameNoise('Amlodipin[unclear: e] 5mg')).toBe('Amlodipin');
  });

  it('keeps multi-word and hyphenated ingredient names intact', () => {
    expect(stripDrugNameNoise('Tab Co-Amoxiclav 625mg TDS')).toBe('Co-Amoxiclav');
  });
});

describe('extractEntitiesByRules', () => {
  it('detects drugs by ingredient suffix without needing a lexicon', () => {
    const entities = extractEntitiesByRules('Patient started on Amoxicillin and Atorvastatin.');
    const drugs = entities.filter((e) => e.type === 'medication').map((e) => e.text);
    expect(drugs).toContain('Amoxicillin');
    expect(drugs).toContain('Atorvastatin');
  });

  it('prefers the longest condition phrase over its substring', () => {
    const entities = extractEntitiesByRules('Diagnosis: Type 2 Diabetes with hypertension');
    const conditions = entities.filter((e) => e.type === 'condition').map((e) => e.text.toLowerCase());
    expect(conditions).toContain('type 2 diabetes');
    expect(conditions).toContain('hypertension');
    expect(conditions).not.toContain('diabetes');
  });

  it('captures dosages and clinical frequency shorthand', () => {
    const entities = extractEntitiesByRules('Metformin 850mg BD, Insulin 10 units HS');
    const dosages = entities.filter((e) => e.type === 'dosage').map((e) => e.text);
    const frequencies = entities
      .filter((e) => e.type === 'frequency')
      .map((e) => e.text.toLowerCase());

    expect(dosages).toContain('850mg');
    expect(dosages).toContain('10 units');
    expect(frequencies).toContain('bd');
    expect(frequencies).toContain('hs');
  });

  it('recognises lab test names including local abbreviations', () => {
    const entities = extractEntitiesByRules('HbA1c 8.4 %, FBS 178 mg/dL, SGPT normal');
    const labs = entities.filter((e) => e.type === 'lab_test').map((e) => e.text.toLowerCase());
    expect(labs).toContain('hba1c');
    expect(labs).toContain('fbs');
    expect(labs).toContain('sgpt');
  });

  it('does not match a condition embedded inside a longer word', () => {
    const entities = extractEntitiesByRules('prediabetesX screening');
    expect(entities.filter((e) => e.type === 'condition')).toHaveLength(0);
  });

  it('returns nothing for text with no medical content', () => {
    expect(extractEntitiesByRules('Please arrive fifteen minutes early.')).toHaveLength(0);
  });
});
