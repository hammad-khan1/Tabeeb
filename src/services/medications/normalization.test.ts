import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { clearMedicationIdentityCache, normalizeMedicationIdentity } from './normalization';

let replies: unknown[];
beforeEach(() => {
  clearMedicationIdentityCache();
  replies = [];
  vi.stubGlobal('fetch', vi.fn(async () => {
    const body = replies.shift();
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function exact(name: string, id: string, type: string) {
  replies.push({ idGroup: { rxnormId: [id] } }, { properties: { rxcui: id, name, tty: type } });
}
function ingredients(values: Array<[string, string]>) {
  replies.push({ relatedGroup: { conceptGroup: [{ tty: 'IN', conceptProperties: values.map(([rxcui, name]) => ({ rxcui, name })) }] } });
}

describe('verified medication identity', () => {
  it('accepts a single exact generic match without an approximate lookup', async () => {
    exact('metformin', '6809', 'IN');
    const result = await normalizeMedicationIdentity('Metformin');
    expect(result.status).toBe('verified');
    expect(result.ingredients).toEqual([{ rxcui: '6809', name: 'metformin' }]);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('&search=0');
  });

  it('resolves a brand only through verified ingredient relationships', async () => {
    exact('Glucophage', '151827', 'BN');
    ingredients([['6809', 'metformin']]);
    expect((await normalizeMedicationIdentity('Glucophage')).ingredients[0].rxcui).toBe('6809');
  });

  it('retains all ingredients of an exact combination product', async () => {
    exact('synthetic combination 500 MG / 5 MG tablet', '12345', 'SCD');
    ingredients([['6809', 'metformin'], ['4815', 'glyburide']]);
    expect((await normalizeMedicationIdentity('SyntheticCombination')).ingredients).toHaveLength(2);
  });

  it('does not choose among multiple exact identities or guess a local brand', async () => {
    replies.push({ idGroup: { rxnormId: ['123', '456'] } });
    expect((await normalizeMedicationIdentity('AmbiguousBrand')).status).toBe('ambiguous');
    replies.push({ idGroup: {} });
    expect((await normalizeMedicationIdentity('UnmappedPakistaniBrand')).status).toBe('unresolved');
  });

  it('rejects an uncertain OCR name before any network request', async () => {
    expect((await normalizeMedicationIdentity('Metfor?in')).status).toBe('ambiguous');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not invent an ingredient from a product ID when relationship lookup fails', async () => {
    exact('Verified product', '12345', 'SCD');
    replies.push(new Error('offline'));
    const result = await normalizeMedicationIdentity('Verified product');
    expect(result.ingredients).toEqual([]);
    expect(result.limitations.join(' ')).toContain('could not be verified');
  });

  it('rejects a brand family spanning several possible ingredient combinations', async () => {
    exact('BrandFamily', '12345', 'BN');
    ingredients([['6809', 'metformin'], ['4815', 'glyburide']]);
    expect((await normalizeMedicationIdentity('BrandFamily')).status).toBe('ambiguous');
  });

  it('preserves release qualifiers and never forces a formulation match', async () => {
    replies.push({ idGroup: {} });
    expect((await normalizeMedicationIdentity('Metformin XR')).status).toBe('unresolved');
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('Metformin%20XR');
  });

  it('preserves combination separators rather than changing the lookup identity', async () => {
    replies.push({ idGroup: {} });
    await normalizeMedicationIdentity('amoxicillin / clavulanate');
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('amoxicillin%20%2F%20clavulanate');
  });

  it('exposes outages and prevents cached identity mutation', async () => {
    replies.push(new Error('offline'));
    expect((await normalizeMedicationIdentity('Metformin')).status).toBe('unavailable');
    exact('metformin', '6809', 'IN');
    const first = await normalizeMedicationIdentity('Metformin');
    first.ingredients.length = 0;
    expect((await normalizeMedicationIdentity('Metformin')).ingredients).toHaveLength(1);
  });
});
