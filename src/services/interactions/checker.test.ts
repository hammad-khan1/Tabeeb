import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DrugConcept } from './rxnav-client';
import type { MedicationObservation } from '../medications/types';

/**
 * Safety regression guards for the interaction checker.
 *
 * Class resemblance must not be reported as a verified allergy relationship.
 * Amoxicillin and omeprazole were previously reported as "the same drug class", because
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

const resolvedInputs: Array<Array<string | { name: string; rxcui?: string | null }>> = [];
vi.mock('./rxnav-client', () => ({
  // Accepts both shapes: current medications are now passed as { name, rxcui } so the
  // stored RxNorm id can skip a network lookup, while queried items stay plain names.
  resolveDrugConcepts: (input: Array<string | { name: string; rxcui?: string | null }>) => {
    resolvedInputs.push(input);
    return Promise.resolve(
      input.map((item) => {
        const name = typeof item === 'string' ? item : item.name;
        return concepts[name] ?? { query: name, rxcui: null, ingredients: [], classes: [] };
      })
    );
  },
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
  ] as Array<{
    name: string; genericName: string; dosage: string; frequency: string; rxnormId: string;
    isActive: boolean; sourceActive?: boolean; patientStatus?: string; observation?: MedicationObservation;
  }>,
  allergies: [{ allergen: 'Penicillin', severity: null, reaction: 'rash' }],
};

const inserted: unknown[] = [];

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    // Fluent through every builder method: terminating at `where` meant that adding
    // an orderBy and a limit to the production query broke tests about allergies.
    select: (cols: Record<string, unknown>) => {
      const rows = 'allergen' in cols ? PROFILE.allergies : PROFILE.medications;
      const chain: Record<string, unknown> = {};
      for (const method of ['from', 'where', 'orderBy', 'limit', 'offset']) {
        chain[method] = () => chain;
      }
      chain.then = (resolve: (value: unknown[]) => unknown) =>
        Promise.resolve(rows).then(resolve);
      return chain;
    },
    insert: () => ({ values: (v: unknown) => { inserted.push(v); return Promise.resolve(); } }),
  }),
}));

const { checkInteractions } = await import('./checker');

beforeEach(() => {
  queriedDrugs = [];
  inserted.length = 0;
  resolvedInputs.length = 0;
  for (const record of PROFILE.medications) {
    delete record.sourceActive;
    delete record.patientStatus;
    delete record.observation;
  }
});

async function check(drugs: string[]) {
  queriedDrugs = drugs;
  return checkInteractions('u1', drugs.join(' '));
}

describe('allergy detection', () => {
  it('does not turn class resemblance into verified allergy cross-reactivity', async () => {
    const r = await check(['amoxicillin']);
    const allergy = r.interactions.filter((i) => i.source === 'allergy_record');

    expect(allergy).toHaveLength(0);
    expect(r.limitations.join(' ')).toContain('cross-reactivity is not assessed');
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
    expect(cls[0].severity).toBe('info');
    expect(cls[0].description).toContain('not evidence of a harmful');
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

  it('stores record findings as informational without invented clinical severity', async () => {
    await check(['penicillin']);
    expect(inserted[0]).toMatchObject({ severity: 'info' });
  });

  it('does not trust legacy model-supplied identifiers', async () => {
    await check(['Glucophage']);
    const query = resolvedInputs.flat().find((item) => typeof item !== 'string' && item.name === 'Metformin');
    expect(query).toEqual({ name: 'Metformin', rxcui: null });
  });

  it('excludes archived and patient-reported historical medicines', async () => {
    PROFILE.medications[0].sourceActive = false;
    expect((await check(['Glucophage'])).interactions).toHaveLength(0);
    PROFILE.medications[0].sourceActive = true;
    PROFILE.medications[0].patientStatus = 'historical';
    expect((await check(['Glucophage'])).interactions).toHaveLength(0);
  });
});
