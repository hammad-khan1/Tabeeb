import { limitConcurrency } from '@/lib/concurrency';

/**
 * RxNav client.
 *
 * NLM retired the free Drug Interaction API on 2 January 2024. The endpoints this
 * file used to call — /interaction/interaction.json and /interaction/list.json —
 * both return 404, and their errors were swallowed, so every interaction check
 * reached the synthesis model with no data at all while still asking it to produce a
 * list of interactions. That made the app present invented interactions as NIH data.
 *
 * There is no free replacement for pairwise DDI screening. What RxNorm *can* still
 * answer, and answer authoritatively, is drug identity: which ingredients a product
 * contains and which therapeutic classes it belongs to. Those support two checks that
 * are genuinely derivable from data — duplicate active ingredient and duplicate
 * therapeutic class — and both are worth surfacing on their own.
 */

const RXNAV_BASE = 'https://rxnav.nlm.nih.gov/REST';
const TIMEOUT_MS = 8_000;

/** NLM asks for under 20 requests/second; this stays well inside it. */
const RXNAV_CONCURRENCY = 4;

export interface DrugConcept {
  /** The name as the caller supplied it. */
  query: string;
  rxcui: string | null;
  /** Active ingredients, lowercased. A combination product has several. */
  ingredients: Array<{ rxcui: string; name: string }>;
  /** ATC therapeutic classes, e.g. B01AA "Vitamin K antagonists". */
  classes: Array<{ classId: string; className: string }>;
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Resolves a drug name to an RxCUI. The previous implementation called
 * `/rxcui?idtype=names&term=`, which RxNav rejects with HTTP 400 — so this always
 * returned null and every downstream lookup was skipped silently.
 */
export async function getRxNormId(drugName: string): Promise<string | null> {
  const term = drugName.trim();
  if (!term) return null;

  const data = (await getJson(
    `${RXNAV_BASE}/rxcui.json?name=${encodeURIComponent(term)}`
  )) as { idGroup?: { rxnormId?: string[] } } | null;

  return data?.idGroup?.rxnormId?.[0] ?? null;
}

interface RelatedResponse {
  relatedGroup?: {
    conceptGroup?: Array<{
      tty?: string;
      conceptProperties?: Array<{ rxcui?: string; name?: string }>;
    }>;
  };
}

/** The active ingredients of a product. A combination returns more than one. */
export async function getIngredients(
  rxcui: string
): Promise<Array<{ rxcui: string; name: string }>> {
  const data = (await getJson(
    `${RXNAV_BASE}/rxcui/${encodeURIComponent(rxcui)}/related.json?tty=IN`
  )) as RelatedResponse | null;

  const groups = data?.relatedGroup?.conceptGroup ?? [];
  return groups
    .filter((group) => group.tty === 'IN')
    .flatMap((group) => group.conceptProperties ?? [])
    .map((concept) => ({
      rxcui: concept.rxcui ?? '',
      name: (concept.name ?? '').toLowerCase(),
    }))
    .filter((concept) => concept.rxcui && concept.name);
}

interface RxClassResponse {
  rxclassDrugInfoList?: {
    rxclassDrugInfo?: Array<{
      rxclassMinConceptItem?: { classId?: string; className?: string; classType?: string };
    }>;
  };
}

/**
 * ATC class names describing a combination product rather than a substance's own
 * therapeutic class. RxClass returns a class for every combination the drug appears
 * in, which produces clinically nonsensical matches: amoxicillin and omeprazole both
 * carry A02BD "Combinations for eradication of Helicobacter pylori", so they were
 * being reported to the patient as belonging to the same drug class.
 *
 * Dropping these can only lose a finding, never invent one — the safe direction.
 */
const COMBINATION_CLASS = /\bcombinations?\b|\band\b/i;

/**
 * ATC therapeutic classes. Restricted to ATC1-4 because the leaf level (ATC5) is the
 * substance itself, which duplicates the ingredient check, and to single-substance
 * classes so that "same class" means what a patient would understand by it.
 */
export async function getTherapeuticClasses(
  rxcui: string
): Promise<Array<{ classId: string; className: string }>> {
  const data = (await getJson(
    `${RXNAV_BASE}/rxclass/class/byRxcui.json?rxcui=${encodeURIComponent(rxcui)}&relaSource=ATC`
  )) as RxClassResponse | null;

  const rows = data?.rxclassDrugInfoList?.rxclassDrugInfo ?? [];
  const seen = new Map<string, string>();

  for (const row of rows) {
    const item = row.rxclassMinConceptItem;
    if (!item?.classId || !item.className) continue;
    if (item.classType && item.classType !== 'ATC1-4') continue;
    if (COMBINATION_CLASS.test(item.className)) continue;
    seen.set(item.classId, item.className);
  }

  return [...seen].map(([classId, className]) => ({ classId, className }));
}

/**
 * Resolves a batch of drug names to full concepts. Failures degrade to a concept with
 * no rxcui rather than throwing, so an RxNav outage cannot fail the whole check —
 * but the caller can tell the difference and say what it could not verify.
 */
export async function resolveDrugConcepts(names: string[]): Promise<DrugConcept[]> {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];

  return limitConcurrency(unique, RXNAV_CONCURRENCY, async (query) => {
    const rxcui = await getRxNormId(query);
    if (!rxcui) {
      return { query, rxcui: null, ingredients: [], classes: [] };
    }

    const [ingredients, classes] = await Promise.all([
      getIngredients(rxcui),
      getTherapeuticClasses(rxcui),
    ]);

    // A single-ingredient concept is its own ingredient; RxNav sometimes omits it.
    const resolved =
      ingredients.length > 0 ? ingredients : [{ rxcui, name: query.toLowerCase() }];

    return { query, rxcui, ingredients: resolved, classes };
  });
}
