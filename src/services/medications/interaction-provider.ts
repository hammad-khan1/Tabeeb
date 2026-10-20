import { z } from 'zod';
import { limitConcurrency } from '@/lib/concurrency';
import type { InteractionCoverage, MedicationRecord } from './types';
import { assertMedicationScope, normalizedText } from './reconciliation';

/** An implementation receives only verified terminology identifiers, never a patient record. */
export interface InteractionProvider {
  id: string;
  version: string | null;
  available: boolean;
  attributionUrl: string | null;
  limitations: string[];
  lookupPair(
    identifiers: readonly [string, string],
    signal: AbortSignal
  ): Promise<ProviderPairResult>;
}

export interface ProviderInteraction {
  description: string;
  severity: string | null;
  evidenceBasis: string;
  referenceUrl: string;
}

export interface ProviderPairResult {
  status: 'available' | 'unavailable' | 'unsupported';
  /** RxCUIs must match the requested pair; a response for a different pair is discarded. */
  identifiers: [string, string];
  version: string | null;
  interactions: ProviderInteraction[];
  limitations: string[];
}

export const unavailableInteractionProvider: InteractionProvider = {
  id: 'No validated interaction provider configured',
  version: null,
  available: false,
  attributionUrl: 'https://www.lhncbc.nlm.nih.gov/RxNav/information/FAQs.html',
  limitations: [
    'Drug–drug interaction screening is unavailable. No validated, appropriately licensed interaction dataset is configured.',
    'RxNorm verifies medicine identity only. The RxNav drug interaction API was retired on January 2, 2024.',
    'Unavailable screening does not mean that the medicines have no interactions.',
  ],
  async lookupPair(identifiers) {
    return {
      status: 'unavailable', identifiers: [...identifiers], version: null, interactions: [],
      limitations: ['No validated interaction provider is configured.'],
    };
  },
};

const pairResultSchema = z.object({
  status: z.enum(['available', 'unavailable', 'unsupported']),
  identifiers: z.tuple([z.string().regex(/^\d{1,12}$/), z.string().regex(/^\d{1,12}$/)]),
  version: z.string().max(200).nullable(),
  interactions: z.array(z.object({
    description: z.string().trim().min(1).max(4000),
    severity: z.string().trim().min(1).max(100).nullable(),
    evidenceBasis: z.string().trim().min(1).max(4000),
    referenceUrl: z.url().refine((url) => url.startsWith('https://')),
  })).max(30),
  limitations: z.array(z.string().max(1000)).max(20),
});

export const MAX_INTERACTION_PAIRS = 40;
export const MAX_SCREENED_INTERACTIONS = 2_000;
const CACHE_MAX = 500;
const CACHE_TTL = 15 * 60 * 1000;
const TIMEOUT_MS = 3_000;
// Cache is scoped to the provider object: two adapters sharing a label cannot share responses.
const caches = new WeakMap<InteractionProvider, Map<string, { expires: number; result: ProviderPairResult }>>();

export function usableMedicationIdentity(record: MedicationRecord) {
  const identity = record.observation.normalization;
  const correctedName = record.corrections.name;
  if (correctedName !== undefined && normalizedText(correctedName) !== normalizedText(record.name)) return null;
  return identity?.status === 'verified' && identity.rxcui && /^\d{1,12}$/.test(identity.rxcui)
    ? identity : null;
}

export interface ScreenedInteraction extends ProviderInteraction {
  medicationIds: [string, string];
  provider: string;
  version: string | null;
}
export interface InteractionScreen {
  coverage: InteractionCoverage;
  interactions: ScreenedInteraction[];
}

async function lookup(
  provider: InteractionProvider, identifiers: [string, string]
): Promise<ProviderPairResult | null> {
  const key = `${provider.version ?? 'unversioned'}:${[...identifiers].sort().join(':')}`;
  let cache = caches.get(provider);
  if (!cache) { cache = new Map(); caches.set(provider, cache); }
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return structuredClone(cached.result);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      provider.lookupPair(identifiers, controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { controller.abort(); reject(new Error('Interaction provider timeout')); }, TIMEOUT_MS);
      }),
    ]);
    const parsed = pairResultSchema.safeParse(result);
    if (!parsed.success || [...parsed.data.identifiers].sort().join(':') !== [...identifiers].sort().join(':')) return null;
    if (parsed.data.status === 'available') {
      if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, { expires: Date.now() + CACHE_TTL, result: structuredClone(parsed.data) });
    }
    return parsed.data;
  } catch {
    // Never turn an outage, invalid evidence, or bad JSON into a negative interaction check.
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Distinct pairs are capped before requests and resolved with concurrency four. Coverage
 * counts medication-record pairs; repeated identifiers share a cached terminology response.
 */
export async function checkMedicationInteractions(
  records: MedicationRecord[],
  provider: InteractionProvider = unavailableInteractionProvider,
  now = new Date().toISOString()
): Promise<InteractionScreen> {
  assertMedicationScope(records[0]?.userId ?? '', records);
  const totalPairs = records.length * (records.length - 1) / 2;
  const coverage: InteractionCoverage = {
    status: provider.available ? 'unsupported' : 'unavailable',
    provider: provider.id, version: provider.version, checkedAt: now,
    checkedPairs: 0, totalPairs, limitations: [
      ...provider.limitations,
      'Pairwise screening uses medicine identifiers only; dose, route, timing and patient-specific contraindications are outside its coverage.',
    ],
  };
  if (!provider.available) return { coverage, interactions: [] };
  if (totalPairs === 0) {
    coverage.limitations.push('Fewer than two eligible medication records are available for pairwise screening.');
    return { coverage, interactions: [] };
  }

  const pairs = new Map<string, { ids: [string, string]; recordPairs: Array<[string, string]> }>();
  let unsupportedPairs = 0;
  for (let first = 0; first < records.length; first += 1) {
    for (let second = first + 1; second < records.length; second += 1) {
      const a = usableMedicationIdentity(records[first]);
      const b = usableMedicationIdentity(records[second]);
      if (!a?.rxcui || !b?.rxcui || a.rxcui === b.rxcui) { unsupportedPairs += 1; continue; }
      const ids = [a.rxcui, b.rxcui].sort() as [string, string];
      const key = ids.join(':');
      const existing = pairs.get(key);
      if (existing) existing.recordPairs.push([records[first].id, records[second].id]);
      else if (pairs.size < MAX_INTERACTION_PAIRS) {
        pairs.set(key, { ids, recordPairs: [[records[first].id, records[second].id]] });
      } else unsupportedPairs += 1;
    }
  }
  const responses = await limitConcurrency([...pairs.values()], 4, async (pair) => ({
    pair, result: await lookup(provider, pair.ids),
  }));
  const interactions: ScreenedInteraction[] = [];
  let failed = false;
  let unsupported = unsupportedPairs > 0;
  let outputTruncated = false;
  for (const { pair, result } of responses) {
    if (!result) { failed = true; continue; }
    coverage.limitations.push(...result.limitations);
    if (result.status !== 'available') { unsupported = true; continue; }
    coverage.checkedPairs += pair.recordPairs.length;
    const remaining = MAX_SCREENED_INTERACTIONS - interactions.length;
    if (pair.recordPairs.length * result.interactions.length > remaining) outputTruncated = true;
    expand: for (const recordPair of pair.recordPairs) {
      for (const interaction of result.interactions) {
        if (interactions.length >= MAX_SCREENED_INTERACTIONS) break expand;
        interactions.push({ ...interaction, medicationIds: recordPair, provider: provider.id, version: result.version ?? provider.version });
      }
    }
  }
  coverage.status = coverage.checkedPairs === totalPairs ? 'available' :
    coverage.checkedPairs > 0 ? 'partial' : failed ? 'failed' : 'unsupported';
  if (outputTruncated) {
    coverage.status = 'partial';
    coverage.limitations.push(`Only the first ${MAX_SCREENED_INTERACTIONS} provider findings are shown. Additional findings were omitted; narrow the medication history for a complete review.`);
  }
  if (unsupported) coverage.limitations.push('Some pairs have unresolved identities, repeat the same concept, lack provider coverage, or exceed the 40 unique-pair evaluation limit.');
  if (failed) coverage.limitations.push('Some interaction requests failed or returned invalid evidence. Those pairs were not cleared.');
  coverage.limitations = [...new Set(coverage.limitations)];
  return { coverage, interactions };
}
