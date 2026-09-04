import { limitConcurrency } from '@/lib/concurrency';

const RXNAV_BASE = 'https://rxnav.nlm.nih.gov/REST';

/**
 * OCR of handwriting garbles drug names ("Metformim", "Amlodipin"), which breaks both the
 * interaction checker and the patient's trust in the record. RxNav's approximateTerm is a
 * free NLM concept-matching service that maps a misspelling back to an RxNorm concept.
 */

export interface NormalizedDrug {
  /** Canonical RxNorm name, or the original input when no confident match was found. */
  name: string;
  rxcui: string | null;
  /** True when the canonical name differs from what was read off the page. */
  corrected: boolean;
  original: string;
}

interface RxNavCandidate {
  rxcui?: string;
  score?: string;
  name?: string;
  source?: string;
}

/**
 * approximateTerm always returns its nearest concept, so an unmatched term still comes back
 * with a low score. Below this the match is noise and would risk renaming a real drug.
 */
const MIN_SCORE = 8;

/** A match may fix OCR noise, not substitute a different drug, so the edit must stay small. */
const MAX_EDIT_RATIO = 0.34;

/**
 * Bounded so a long-running process cannot grow this without limit. Insertion-ordered
 * eviction is enough here: the working set is one patient's medicines, and a miss
 * costs one RxNav call.
 */
const CACHE_MAX_ENTRIES = 2_000;
const cache = new Map<string, NormalizedDrug>();

function cacheSet(key: string, value: NormalizedDrug): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

/** NLM asks clients to stay under 20 requests a second. */
const RXNAV_CONCURRENCY = 4;

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    previous = current;
  }

  return previous[b.length];
}

/**
 * Prescriptions are written as "Tab. Metformin 850mg BD"; RxNav only matches the ingredient,
 * so dosage form, strength, frequency and OCR uncertainty markers have to come off first.
 */
export function stripDrugNameNoise(raw: string): string {
  return raw
    .replace(/\[unclear:[^\]]*\]/gi, ' ')
    .replace(/\b(?:tabs?|tablets?|caps?|capsules?|syp|syrup|susp|suspension|inj|injection|drops?|cream|ointment|sachet)\b\.?/gi, ' ')
    .replace(/\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|ml|l|iu|units?|%)/gi, ' ')
    .replace(/\b(?:od|bd|bid|tds|tid|qid|qds|hs|sos|prn|stat|po|iv|im|sc)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const RXNAV_TIMEOUT_MS = 8_000;

/** A cold-start blip was observed to silently drop a valid correction, so one retry is made. */
const RXNAV_ATTEMPTS = 2;

async function fetchCandidates(term: string): Promise<RxNavCandidate[]> {
  const url = `${RXNAV_BASE}/approximateTerm.json?term=${encodeURIComponent(term)}&maxEntries=10`;
  let lastError: unknown;

  for (let attempt = 1; attempt <= RXNAV_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(RXNAV_TIMEOUT_MS),
      });
      if (!response.ok) return [];

      const data = await response.json();
      const candidates = data?.approximateGroup?.candidate;
      return Array.isArray(candidates) ? candidates : [];
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

/**
 * Resolves a possibly-misread drug name to an RxNorm concept. Returns the input unchanged
 * whenever the service is unreachable or no candidate clears the confidence guards, so a
 * normalization failure can never drop a medication from the record.
 */
export async function normalizeDrugName(rawName: string): Promise<NormalizedDrug> {
  const original = rawName.trim();
  const unresolved: NormalizedDrug = {
    name: original,
    rxcui: null,
    corrected: false,
    original,
  };

  const term = stripDrugNameNoise(original);
  if (term.length < 3) return unresolved;

  const cacheKey = term.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return { ...cached, original };

  let candidates: RxNavCandidate[];
  try {
    candidates = await fetchCandidates(term);
  } catch {
    return unresolved;
  }

  const acceptable = candidates.filter((candidate) => {
    if (!candidate.rxcui || !candidate.name) return false;
    if (Number(candidate.score) < MIN_SCORE) return false;
    const distance = editDistance(term.toLowerCase(), candidate.name.toLowerCase());
    return distance / Math.max(term.length, candidate.name.length) <= MAX_EDIT_RATIO;
  });

  // Several source vocabularies report the same rxcui; RXNORM carries the canonical spelling.
  // Lock onto RxNav's top-ranked concept first so a preferred spelling cannot pull in a
  // lower-ranked, different drug.
  const topRanked = acceptable[0];
  const best = topRanked
    ? acceptable.find(
        (candidate) => candidate.rxcui === topRanked.rxcui && candidate.source === 'RXNORM'
      ) ?? topRanked
    : undefined;

  if (!best?.name || !best.rxcui) {
    cacheSet(cacheKey, unresolved);
    return unresolved;
  }

  const resolved: NormalizedDrug = {
    name: best.name,
    rxcui: best.rxcui,
    corrected: best.name.toLowerCase() !== term.toLowerCase(),
    original,
  };

  cacheSet(cacheKey, resolved);
  return resolved;
}

/**
 * Throttled rather than `Promise.all`: a patient on a dozen medicines would otherwise
 * open a dozen simultaneous connections to NLM from a single upload.
 */
export async function normalizeDrugNames(names: string[]): Promise<NormalizedDrug[]> {
  return limitConcurrency(names, RXNAV_CONCURRENCY, (name) => normalizeDrugName(name));
}
