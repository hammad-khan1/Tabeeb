import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkMedicationInteractions, MAX_INTERACTION_PAIRS, MAX_SCREENED_INTERACTIONS, type InteractionProvider, type ProviderPairResult } from './interaction-provider';
import { identity, medication } from './test-fixtures';

function provider(): InteractionProvider {
  return {
    id: 'Synthetic licensed provider', version: 'test-1', attributionUrl: 'https://example.org/test-evidence',
    available: true, limitations: ['Synthetic test data only.'],
    lookupPair: vi.fn(async (identifiers: readonly [string, string]): Promise<ProviderPairResult> => ({
      identifiers: [...identifiers], status: 'available', version: 'test-1', limitations: [],
      interactions: [{
        description: 'Synthetic documented interaction.',
        severity: 'provider-defined-example',
        evidenceBasis: 'Synthetic fixture, not clinical evidence.',
        referenceUrl: 'https://example.org/test-evidence',
      }],
    })),
  };
}
function pair() {
  return [medication(), medication({
    id: 'med-b', name: 'Aspirin', documentId: 'doc-b',
    observation: { originalName: 'Aspirin', normalization: identity('1191', 'aspirin') },
  })];
}
afterEach(() => vi.useRealTimers());

describe('validated interaction provider boundary', () => {
  it('reports unavailable screening, never no interactions, by default', async () => {
    const result = await checkMedicationInteractions(pair());
    expect(result.coverage.status).toBe('unavailable');
    expect(result.coverage.checkedPairs).toBe(0);
    expect(result.coverage.limitations.join(' ')).toContain('does not mean');
    expect(result.interactions).toEqual([]);
  });

  it('passes only RxCUIs and preserves source-defined severity and evidence', async () => {
    const source = provider();
    const result = await checkMedicationInteractions(pair(), source);
    expect(source.lookupPair).toHaveBeenCalledWith(['1191', '6809'], expect.any(AbortSignal));
    expect(result.coverage.status).toBe('available');
    expect(result.interactions[0].severity).toBe('provider-defined-example');
    expect(result.interactions[0].version).toBe('test-1');
    expect(JSON.stringify(vi.mocked(source.lookupPair).mock.calls)).not.toContain('synthetic-owner');
  });

  it('caches bounded successful responses but not provider errors', async () => {
    const source = provider();
    await checkMedicationInteractions(pair(), source);
    await checkMedicationInteractions(pair(), source);
    expect(source.lookupPair).toHaveBeenCalledTimes(1);
    const offline = provider();
    vi.mocked(offline.lookupPair).mockRejectedValue(new Error('offline'));
    const result = await checkMedicationInteractions(pair(), offline);
    expect(result.coverage.status).toBe('failed');
    expect(result.coverage.checkedPairs).toBe(0);
    await checkMedicationInteractions(pair(), offline);
    expect(offline.lookupPair).toHaveBeenCalledTimes(2);
  });

  it('rejects evidence-free or mismatched responses', async () => {
    const source = provider();
    vi.mocked(source.lookupPair).mockResolvedValue({
      status: 'available', identifiers: ['42', '43'], version: null, interactions: [], limitations: [],
    });
    expect((await checkMedicationInteractions(pair(), source)).coverage.status).toBe('failed');
    vi.mocked(source.lookupPair).mockResolvedValue({
      status: 'available', identifiers: ['1191', '6809'], version: null, limitations: [],
      interactions: [{ description: 'Claim', severity: null, referenceUrl: '', evidenceBasis: '' }],
    });
    expect((await checkMedicationInteractions(pair(), source)).coverage.status).toBe('failed');
  });

  it('does not reuse a source identity after a patient changes the name', async () => {
    const records = pair();
    records[0].corrections = { name: 'Different medicine' };
    const source = provider();
    expect((await checkMedicationInteractions(records, source)).coverage.status).toBe('unsupported');
    expect(source.lookupPair).not.toHaveBeenCalled();
  });

  it('limits requests and exposes partial coverage for large histories', async () => {
    const records = Array.from({ length: 12 }, (_, index) => medication({
      id: `med-${index}`, name: `Synthetic ${index}`,
      observation: { normalization: identity(String(1000 + index), `synthetic ${index}`) },
    }));
    const source = provider();
    const result = await checkMedicationInteractions(records, source);
    expect(source.lookupPair).toHaveBeenCalledTimes(MAX_INTERACTION_PAIRS);
    expect(result.coverage.totalPairs).toBe(66);
    expect(result.coverage.status).toBe('partial');
  });

  it('caps expanded findings when one identifier pair occurs throughout a large history', async () => {
    const records = Array.from({ length: 100 }, (_, index) => medication({
      id: `med-${index}`,
      observation: { normalization: identity(index < 50 ? '1000' : '2000') },
    }));
    const source = provider();
    const result = await checkMedicationInteractions(records, source);
    expect(source.lookupPair).toHaveBeenCalledTimes(1);
    expect(result.coverage.checkedPairs).toBe(2500);
    expect(result.interactions).toHaveLength(MAX_SCREENED_INTERACTIONS);
    expect(result.coverage.status).toBe('partial');
    expect(result.coverage.limitations.join(' ')).toContain('Additional findings were omitted');
  });

  it('times out even if an adapter ignores its abort signal', async () => {
    vi.useFakeTimers();
    const source = provider();
    vi.mocked(source.lookupPair).mockImplementation(() => new Promise(() => {}));
    const pending = checkMedicationInteractions(pair(), source);
    await vi.advanceTimersByTimeAsync(3_001);
    expect((await pending).coverage.status).toBe('failed');
  });
});
