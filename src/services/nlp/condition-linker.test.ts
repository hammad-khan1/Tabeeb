import { describe, it, expect } from 'vitest';
import {
  linkCondition,
  linkConditions,
  suggestIcd10,
  canonicalConditionName,
  normalizeConditionName,
  CONDITION_CATALOGUE,
} from './condition-linker';

describe('normalizeConditionName', () => {
  it('strips clinical wrappers and normalises roman numerals', () => {
    expect(normalizeConditionName('Known case of uncontrolled Type II DM')).toBe('type 2 dm');
    expect(normalizeConditionName('H/O Hypertension (essential)')).toBe('hypertension');
  });
});

describe('linkCondition', () => {
  it('resolves the many spellings of type 2 diabetes to one concept', () => {
    const written = ['Type 2 Diabetes Mellitus', 'T2DM', 'DM type II', 'diabetes'];
    const codes = written.map((name) => linkCondition(name)?.concept.icd10);
    expect(codes).toEqual(['E11.9', 'E11.9', 'E11.9', 'E11.9']);
  });

  it('keeps type 1 and type 2 apart', () => {
    expect(linkCondition('IDDM')?.concept.icd10).toBe('E10.9');
    expect(linkCondition('NIDDM')?.concept.icd10).toBe('E11.9');
  });

  it('resolves the Urdu word patients use', () => {
    const link = linkCondition('شوگر');
    expect(link?.concept.icd10).toBe('E11.9');
    expect(link?.matchedOn).toBe('local-language');
  });

  it('matches a reordered label at full confidence', () => {
    const link = linkCondition('Known case of uncontrolled Type II DM');
    expect(link?.concept.icd10).toBe('E11.9');
    expect(link?.matchedOn).toBe('alias');
  });

  it('matches a qualified label partially and flags the lower confidence', () => {
    const link = linkCondition('severe left sided migraine headache with aura');
    expect(link?.concept.icd10).toBe('G43.909');
    expect(link?.matchedOn).toBe('partial');
    expect(link!.confidence).toBeLessThan(0.85);
  });

  it('returns null rather than guessing at anything uncatalogued', () => {
    expect(linkCondition('Ehlers-Danlos syndrome')).toBeNull();
    expect(linkCondition('   ')).toBeNull();
  });
});

describe('suggestIcd10', () => {
  it('codes confident matches', () => {
    expect(suggestIcd10('hepatitis c')).toBe('B18.2');
    expect(suggestIcd10('CKD stage 3')).toBe('N18.9');
    expect(suggestIcd10('HTN')).toBe('I10');
  });

  it('refuses to code a partial match', () => {
    expect(suggestIcd10('severe left sided migraine headache with aura')).toBeNull();
  });
});

describe('canonicalConditionName', () => {
  it('groups records written differently under one name', () => {
    expect(canonicalConditionName('t2dm')).toBe('Type 2 diabetes mellitus');
    expect(canonicalConditionName('sugar ki bimari')).toBe('sugar ki bimari');
  });

  it('links a batch and dedupes repeated inputs', () => {
    const links = linkConditions(['DM', 'diabetes mellitus', 'شوگر', 'DM']);
    expect(links.size).toBe(3);
    expect([...links.values()].every((link) => link?.concept.icd10 === 'E11.9')).toBe(true);
  });
});

describe('catalogue integrity', () => {
  it('has no duplicate ICD-10 codes', () => {
    const codes = CONDITION_CATALOGUE.map((concept) => concept.icd10);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every concept a code, a name and a category', () => {
    for (const concept of CONDITION_CATALOGUE) {
      expect(concept.icd10).toMatch(/^[A-Z]\d{2}(\.\d{1,3})?$/);
      expect(concept.canonical.length).toBeGreaterThan(2);
      expect(concept.category.length).toBeGreaterThan(2);
    }
  });
});
