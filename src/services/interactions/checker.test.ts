import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DrugConcept } from './rxnav-client';

/**
 * Safety regression guards for the interaction checker.
 *
 * Two of these encode bugs found by running the real thing against live RxNav data:
 *
 *  - a patient allergic to penicillin asking about amoxicillin got NO warning, because
 *    the match only compared names and ingredients and "amoxicillin" is neither
 *  - amoxicillin and omeprazole were reported as "the same drug class", because
 *    RxClass returns a class for every combination product a drug appears in and both
 *    carry A02BD "Combinations for eradication of Helicobacter pylori"
 *
 * The model is mocked out entirely: findings must come from data, never from it.
 */

const concepts: Record<string, DrugConcept> = {
  amoxicillin: {
    query: 'amoxicillin',
    rxcui: '723',
    ingredients: [{ rxcui: '723', name: 'amoxicillin' }],
    classes: [{ classId: 'J01CA', className: 'Penicillins with extended spectrum' }],
  },
  penicillin: {
    query: 'penicillin',
    rxcui: '7980',
    ingredients: [{ rxcui: '7980', name: 'penicillin g' }],
    classes: [{ classId: 'J01CE', className: 'Beta-lactamase sensitive penicillins' }],
  },
  Glucophage: {
    query: 'Glucophage',
    rxcui: '153592',
    ingredients: [{ rxcui: '6809', name: 'metformin' }],
    classes: [{ classId: 'A10BA', className: 'Biguanides' }],
  },
  nifedipine: {
    query: 'nifedipine',
    rxcui: '7417',
    ingredients: [{ rxcui: '7417', name: 'nifedipine' }],
    classes: [{ classId: 'C08CA', className: 'Dihydropyridine derivatives' }],
  },
  paracetamol: {
    query: 'paracetamol',
    rxcui: '161',
    ingredients: [{ rxcui: '161', name: 'acetaminophen' }],
    classes: [{ classId: 'N02BE', className: 'Anilides' }],
  },
  Metformin: {
    query: 'Metformin',
    rxcui: '6809',
    ingredients: [{ rxcui: '6809', name: 'metformin' }],
    classes: [{ classId: 'A10BA', className: 'Biguanides' }],
  },
  Amlodipine: {
    query: 'Amlodipine',
    rxcui: '17767',
    ingredients: [{ rxcui: '17767', name: 'amlodipine' }],
    classes: [{ classId: 'C08CA', className: 'Dihydropyridine derivatives' }],
  },
};

vi.mock('./rxnav-client', () => ({
  resolveDrugConcepts: (names: string[]) =>
    Promise.resolve(
      names.map(
        (n) => concepts[n] ?? { query: n, rxcui: null, ingredients: [], classes: [] }
      )
    ),
}));

let queriedDrugs: string[] = [];

vi.mock('@/lib/groq', () => ({
  MODELS: { primary: 'p', fast: 'f' },
  getGroq: () => ({
    chat: {
      completions: {
        create: (opts: { messages: Array<{ content: string }> }) => {
          const isExtraction = opts.messages[0].content.includes('Extract the drug names');
          return Promise.resolve({
            choices: [
              {
                message: {
                  content: isExtraction
                    ? JSON.stringify({ drugs: queriedDrugs, foods: [], supplements: [] })
                    : JSON.stringify({ summary: 'stub summary', recommendation: 'stub rec' }),
                },
              },
            ],
          });
        },
      },
    },
  }),
}));

const PROFILE = {
  medications: [
    { name: 'Metformin', genericName: 'Metformin', dosage: '850mg', frequency: 'BD', rxnormId: '6809', isActive: true },
    { name: 'Amlodipine', genericName: 'Amlodipine', dosage: '5mg', frequency: 'OD', rxnormId: '17767', isActive: true },
  ],
  allergies: [{ allergen: 'Penicillin', severity: null, reaction: 'rash' }],
};

const inserted: unknown[] = [];

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    select: (cols: Record<string, unknown>) => ({
      from: () => ({
        where: () =>
          Promise.resolve('allergen' in cols ? PROFILE.allergies : PROFILE.medications),
      }),
    }),
    insert: () => ({ values: (v: unknown) => { inserted.push(v); return Promise.resolve(); } }),
  }),
}));

const { checkInteractions } = await import('./checker');

beforeEach(() => {
  queriedDrugs = [];
  inserted.length = 0;
});

async function check(drugs: string[]) {
  queriedDrugs = drugs;
  return checkInteractions('u1', drugs.join(' '));
}

describe('allergy detection', () => {
  it('flags a drug in the allergen class, not just the allergen itself', async () => {
    // The dangerous miss: amoxicillin neither contains nor equals "penicillin", but
    // its ATC class is "Penicillins with extended spectrum".
    const r = await check(['amoxicillin']);
    const allergy = r.interactions.filter((i) => i.source === 'allergy_record');

    expect(allergy).toHaveLength(1);
    expect(allergy[0].severity).toBe('severe');
    expect(allergy[0].description).toMatch(/Penicillins with extended spectrum/);
  });

  it('flags the allergen itself', async () => {
    const r = await check(['penicillin']);
    expect(r.interactions.some((i) => i.source === 'allergy_record')).toBe(true);
  });

  it('does not flag an unrelated drug', async () => {
    const r = await check(['paracetamol']);
    expect(r.interactions).toHaveLength(0);
  });
});

describe('duplicate therapy detection', () => {
  it('flags a brand name sharing an ingredient with a current medicine', async () => {
    const r = await check(['Glucophage']);
    const dup = r.interactions.filter((i) => i.source === 'rxnorm_ingredient');

    expect(dup).toHaveLength(1);
    expect(dup[0].items).toEqual(['Glucophage', 'Metformin']);
    expect(dup[0].description).toMatch(/metformin/);
  });

  it('flags a shared therapeutic class', async () => {
    const r = await check(['nifedipine']);
    const cls = r.interactions.filter((i) => i.source === 'rxnorm_class');

    expect(cls).toHaveLength(1);
    expect(cls[0].items).toEqual(['nifedipine', 'Amlodipine']);
    expect(cls[0].severity).toBe('mild');
  });

  it('does not report a class match on top of an ingredient match', async () => {
    // Glucophage and Metformin share both; reporting twice would double-count.
    const r = await check(['Glucophage']);
    expect(r.interactions.filter((i) => i.source === 'rxnorm_class')).toHaveLength(0);
  });
});

describe('honesty about what was checked', () => {
  it('always states that drug-drug interaction screening was not performed', async () => {
    const r = await check(['paracetamol']);
    expect(r.limitations.join(' ')).toMatch(/does not include drug–drug interaction screening/i);
  });

  it('names items it could not resolve rather than implying they were cleared', async () => {
    const r = await check(['green tea']);
    expect(r.unverifiedItems).toContain('green tea');
    expect(r.limitations.join(' ')).toMatch(/green tea/);
  });

  it('returns no findings when nothing was named', async () => {
    const r = await check([]);
    expect(r.interactions).toEqual([]);
    expect(r.limitations.join(' ')).toMatch(/drug–drug/i);
  });

  it('records the highest severity found', async () => {
    await check(['amoxicillin']);
    expect(inserted[0]).toMatchObject({ severity: 'severe' });
  });
});
