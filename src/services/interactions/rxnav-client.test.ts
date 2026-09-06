import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveDrugConcepts, clearConceptCache } from './rxnav-client';

/**
 * The RxNorm id is recorded on every medication during extraction and was then
 * ignored: each check re-resolved every current medicine by name. At three requests
 * per drug, a patient on eight medicines cost twenty-four round-trips per check for
 * data already in the database.
 */

const realFetch = globalThis.fetch;
let requested: string[] = [];

function stubFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);

    if (url.includes('/rxcui.json')) {
      return new Response(JSON.stringify({ idGroup: { rxnormId: ['6809'] } }), { status: 200 });
    }
    if (url.includes('/related.json')) {
      return new Response(
        JSON.stringify({
          relatedGroup: {
            conceptGroup: [
              { tty: 'IN', conceptProperties: [{ rxcui: '6809', name: 'metformin' }] },
            ],
          },
        }),
        { status: 200 }
      );
    }
    return new Response(JSON.stringify({ rxclassDrugInfoList: { rxclassDrugInfo: [] } }), {
      status: 200,
    });
  }) as typeof fetch;
}

beforeEach(() => {
  requested = [];
  clearConceptCache();
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('resolveDrugConcepts', () => {
  it('skips the name lookup when the RxNorm id is already known', async () => {
    await resolveDrugConcepts([{ name: 'metformin', rxcui: '6809' }]);
    expect(requested.some((url) => url.includes('/rxcui.json'))).toBe(false);
  });

  it('falls back to the name lookup when no id is stored', async () => {
    await resolveDrugConcepts([{ name: 'metformin', rxcui: null }]);
    expect(requested.some((url) => url.includes('/rxcui.json'))).toBe(true);
  });

  it('still accepts plain names, for items the patient typed', async () => {
    const [concept] = await resolveDrugConcepts(['metformin']);
    expect(concept.rxcui).toBe('6809');
  });

  it('does not repeat lookups for a concept it has already resolved', async () => {
    await resolveDrugConcepts([{ name: 'metformin', rxcui: '6809' }]);
    const first = requested.length;

    await resolveDrugConcepts([{ name: 'metformin', rxcui: '6809' }]);
    expect(requested.length).toBe(first);
  });

  it('keeps the caller’s name on a cached result', async () => {
    await resolveDrugConcepts([{ name: 'Glucophage', rxcui: '6809' }]);
    const [again] = await resolveDrugConcepts([{ name: 'metformin', rxcui: '6809' }]);
    // Same concept, but reported under the name that was asked about.
    expect(again.query).toBe('metformin');
    expect(again.ingredients[0].name).toBe('metformin');
  });

  it('prefers an entry carrying an id over a bare duplicate name', async () => {
    await resolveDrugConcepts(['metformin', { name: 'metformin', rxcui: '6809' }]);
    expect(requested.some((url) => url.includes('/rxcui.json'))).toBe(false);
  });

  it('ignores blank entries', async () => {
    expect(await resolveDrugConcepts(['', '   ', { name: '' }])).toEqual([]);
  });
});
