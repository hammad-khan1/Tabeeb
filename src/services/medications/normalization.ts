import { stripDrugNameNoise } from '@/services/nlp/drug-normalizer';
import type { MedicationIdentity } from './types';

const BASE = 'https://rxnav.nlm.nih.gov/REST';
const CACHE_LIMIT = 500;
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { expires: number; value: MedicationIdentity }>();

interface JsonResult { ok: boolean; data: unknown }
async function request(path: string): Promise<JsonResult> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(4_000),
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, data: null };
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false, data: null };
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && /^\d{1,12}$/.test(id)))]
    : [];
}

export function unresolvedMedicationIdentity(
  status: MedicationIdentity['status'] = 'unresolved',
  reason = 'The documented medicine name has not been verified in RxNorm.'
): MedicationIdentity {
  return {
    status, normalizedName: null, rxcui: null, conceptType: null,
    ingredients: [], provider: null, version: null, checkedAt: null, limitations: [reason],
  };
}

/**
 * Only exact terminology matches are accepted. Approximate OCR candidates and model-supplied
 * RxCUIs are never promoted to verified identities. Only a medicine name leaves this function.
 * Strength, route, release form and source text remain separate documented observations.
 */
export async function normalizeMedicationIdentity(name: string): Promise<MedicationIdentity> {
  if (!name || name.length > 200 || /\[unclear|[?]/i.test(name)) {
    return unresolvedMedicationIdentity('ambiguous', 'The documented name is incomplete or marked unclear; verify it against the source.');
  }
  const term = stripDrugNameNoise(name);
  if (term.length < 2) return unresolvedMedicationIdentity();
  const key = term.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return structuredClone(cached.value);

  const lookup = await request(`/rxcui.json?name=${encodeURIComponent(term)}&search=0`);
  if (!lookup.ok) return unresolvedMedicationIdentity('unavailable', 'RxNorm identity lookup was unavailable; the documented medicine is retained.');
  const matches = ids(object(object(lookup.data).idGroup).rxnormId);
  if (matches.length !== 1) {
    return unresolvedMedicationIdentity(
      matches.length > 1 ? 'ambiguous' : 'unresolved',
      matches.length > 1 ? 'RxNorm returned multiple identities; none was selected.' : 'No exact RxNorm name match was found. Local brands and alternate spellings may require manual verification.'
    );
  }
  const rxcui = matches[0];
  const propertiesResult = await request(`/rxcui/${rxcui}/properties.json`);
  if (!propertiesResult.ok) return unresolvedMedicationIdentity('unavailable', 'RxNorm concept verification was unavailable.');
  const properties = object(object(propertiesResult.data).properties);
  const normalizedName = text(properties.name);
  const conceptType = text(properties.tty);
  if (!normalizedName || properties.rxcui !== rxcui || !conceptType ||
      !['IN', 'PIN', 'MIN', 'BN', 'SCD', 'SBD', 'SCDC', 'SBDC', 'SCDF', 'SBDF'].includes(conceptType)) {
    return unresolvedMedicationIdentity('unresolved', 'The returned terminology concept could not be verified as a supported medicine concept.');
  }

  let ingredients: MedicationIdentity['ingredients'] = [];
  const limitations: string[] = [];
  if (conceptType === 'IN') {
    ingredients = [{ rxcui, name: normalizedName }];
  } else {
    const related = await request(`/rxcui/${rxcui}/related.json?tty=IN`);
    const groups = object(object(related.data).relatedGroup).conceptGroup;
    if (related.ok && Array.isArray(groups)) {
      const unique = new Map<string, string>();
      for (const group of groups) {
        const row = object(group);
        if (row.tty !== 'IN' || !Array.isArray(row.conceptProperties)) continue;
        for (const item of row.conceptProperties.slice(0, 30)) {
          const ingredient = object(item);
          const id = ids([ingredient.rxcui])[0];
          const ingredientName = text(ingredient.name);
          if (id && ingredientName) unique.set(id, ingredientName);
        }
      }
      ingredients = [...unique].map(([id, ingredientName]) => ({ rxcui: id, name: ingredientName }));
    }
    if (!ingredients.length) limitations.push('Active ingredients could not be verified; ingredient and ingredient-allergy checks are incomplete.');
    // Brand families can span distinct products. Their union of related ingredients is not
    // evidence that the documented product contains all of them.
    if (['BN', 'SCDF', 'SBDF'].includes(conceptType) && ingredients.length > 1) {
      return unresolvedMedicationIdentity('ambiguous', 'The terminology concept covers more than one possible ingredient combination; an exact product is needed.');
    }
  }
  const result: MedicationIdentity = {
    status: 'verified', normalizedName, rxcui, conceptType, ingredients,
    provider: 'RxNorm', version: null, checkedAt: new Date().toISOString(),
    limitations: [...limitations, 'RxNorm establishes identity only. It does not verify the documented dose, release form, route, current use or drug interactions.'],
  };
  // Failures and partial ingredient lookups are never cached as successful coverage.
  if (ingredients.length) {
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value: structuredClone(result) });
  }
  return result;
}

export function clearMedicationIdentityCache(): void {
  cache.clear();
}
