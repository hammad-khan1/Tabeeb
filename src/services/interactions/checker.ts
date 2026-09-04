import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { getGroq, MODELS } from '@/lib/groq';
import { medications, allergies, interactionChecks } from '../../../drizzle/schema';
import { resolveDrugConcepts, type DrugConcept } from './rxnav-client';

/**
 * What this can and cannot check.
 *
 * Pairwise drug–drug interaction screening needs a licensed dataset (DrugBank, First
 * Databank, Medi-Span). NLM's free Drug Interaction API — which this used to call —
 * was retired in January 2024. So this no longer claims to do interaction screening.
 *
 * What it does do is derive findings that follow from data it can actually verify:
 *   - the queried drug shares an active ingredient with something already prescribed
 *     (double-dosing, the most common real-world medication error)
 *   - the queried drug shares an ATC therapeutic class with a current medication
 *   - the queried drug matches a recorded allergy
 *
 * The model's job is to explain those findings in plain language. It is never asked
 * to produce findings of its own, because a model asked for interactions will always
 * produce some.
 */

export type InteractionSeverity = 'info' | 'mild' | 'moderate' | 'severe' | 'contraindicated';

export interface InteractionResult {
  items: string[];
  severity: InteractionSeverity;
  description: string;
  /** Where the finding came from, so the UI can show it and the user can judge it. */
  source: 'rxnorm_ingredient' | 'rxnorm_class' | 'allergy_record';
}

export interface InteractionCheckResponse {
  interactions: InteractionResult[];
  summary: string;
  recommendation: string;
  /** Names that could not be resolved to an RxNorm concept, so were not checked. */
  unverifiedItems: string[];
  /** Always includes the DDI limitation — the UI must show this. */
  limitations: string[];
}

const DDI_LIMITATION =
  'This check does not include drug–drug interaction screening. That requires a licensed clinical database, which this app is not connected to. It compares ingredients and drug classes against your recorded medicines and allergies only. Ask your pharmacist or doctor before combining medicines.';

const ENTITY_EXTRACTION_PROMPT = `Extract the drug names, food items and supplements mentioned in the user's query.

Return JSON with exactly this structure:
{ "drugs": ["name"], "foods": ["name"], "supplements": ["name"] }

Rules:
- Only include items explicitly mentioned. Return empty arrays when none are present.
- Use the drug's own name without dosage, form or frequency: "Panadol 500mg BD" is "Panadol".
- The query may be in English, Urdu or a mix. Return names in Latin script.
- Never add an item the user did not mention.`;

const entitiesSchema = z.object({
  drugs: z.array(z.string().trim().min(1).max(200)).max(30).catch([]),
  foods: z.array(z.string().trim().min(1).max(200)).max(30).catch([]),
  supplements: z.array(z.string().trim().min(1).max(200)).max(30).catch([]),
});

/** Only the prose is taken from the model; findings come from `deriveFindings`. */
const explanationSchema = z.object({
  summary: z.string().trim().min(1).max(4000),
  recommendation: z.string().trim().min(1).max(2000),
});

async function extractEntities(query: string) {
  const response = await getGroq().chat.completions.create({
    model: MODELS.fast,
    messages: [
      { role: 'system', content: ENTITY_EXTRACTION_PROMPT },
      { role: 'user', content: query },
    ],
    temperature: 0.1,
    max_tokens: 512,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  const empty = { drugs: [], foods: [], supplements: [] };
  if (!content) return empty;

  try {
    const parsed = entitiesSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : empty;
  } catch {
    return empty;
  }
}

async function fetchPatientProfile(userId: string) {
  const [medRows, allergyRows] = await Promise.all([
    getDb()
      .select({
        name: medications.name,
        genericName: medications.genericName,
        dosage: medications.dosage,
        frequency: medications.frequency,
        rxnormId: medications.rxnormId,
        isActive: medications.isActive,
      })
      .from(medications)
      .where(eq(medications.userId, userId)),
    getDb()
      .select({
        allergen: allergies.allergen,
        severity: allergies.severity,
        reaction: allergies.reaction,
      })
      .from(allergies)
      .where(eq(allergies.userId, userId)),
  ]);

  return { medications: medRows, allergies: allergyRows };
}

const SEVERITY_ORDER: Record<InteractionSeverity, number> = {
  info: 0,
  mild: 1,
  moderate: 2,
  severe: 3,
  contraindicated: 4,
};

function maxSeverity(interactions: InteractionResult[]): InteractionSeverity {
  let max: InteractionSeverity = 'info';
  for (const interaction of interactions) {
    if (SEVERITY_ORDER[interaction.severity] > SEVERITY_ORDER[max]) {
      max = interaction.severity;
    }
  }
  return max;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Crude singularisation so "Penicillin" matches the class "Penicillins ...". */
function singular(word: string): string {
  return word.endsWith('s') && word.length > 4 ? word.slice(0, -1) : word;
}

/**
 * Whether a drug is covered by a recorded allergy.
 *
 * Name and ingredient equality alone is not enough, and the gap is dangerous: a
 * patient allergic to penicillin asking about amoxicillin got no warning, because
 * "amoxicillin" neither contains nor equals "penicillin". The link is the drug class —
 * amoxicillin's ATC class is J01CA "Penicillins with extended spectrum" — so the
 * allergen is checked against class names too.
 */
function allergyMatches(drug: DrugConcept, allergenKey: string): boolean {
  if (!allergenKey) return false;
  const needle = singular(allergenKey);

  if (normalize(drug.query).split(' ').some((w) => singular(w) === needle)) return true;
  if (drug.ingredients.some((i) => singular(normalize(i.name)) === needle)) return true;

  // Class-level cover: "penicillin" against "Penicillins with extended spectrum".
  return drug.classes.some((c) =>
    normalize(c.className).split(' ').some((word) => singular(word) === needle)
  );
}

/**
 * The whole finding set, derived from resolved concepts and the stored record. No
 * model output reaches this function.
 */
function deriveFindings(
  queried: DrugConcept[],
  current: DrugConcept[],
  currentLabels: Map<string, string>,
  allergyRows: Array<{ allergen: string; severity: string | null; reaction: string | null }>
): InteractionResult[] {
  const findings: InteractionResult[] = [];

  const allergens = allergyRows.map((row) => ({ ...row, key: normalize(row.allergen) }));

  for (const drug of queried) {
    const drugIngredients = new Set(drug.ingredients.map((i) => i.name));

    // ── Allergy match ────────────────────────────────────────────────────────
    for (const allergy of allergens) {
      if (!allergyMatches(drug, allergy.key)) continue;

      const sameSubstance =
        normalize(drug.query).includes(allergy.key) ||
        drug.ingredients.some((i) => normalize(i.name) === allergy.key);

      findings.push({
        items: [drug.query, allergy.allergen],
        // A documented allergy to the same substance is the strongest signal available.
        severity: allergy.severity?.toLowerCase() === 'severe' ? 'contraindicated' : 'severe',
        description: sameSubstance
          ? `Your record lists an allergy to ${allergy.allergen}${
              allergy.reaction ? ` (reaction: ${allergy.reaction})` : ''
            }, and ${drug.query} matches it.`
          : `${drug.query} belongs to the ${
              drug.classes.find((c) =>
                normalize(c.className).split(' ').some((w) => singular(w) === singular(allergy.key))
              )?.className ?? allergy.allergen
            } group, and your record lists an allergy to ${allergy.allergen}${
              allergy.reaction ? ` (reaction: ${allergy.reaction})` : ''
            }.`,
        source: 'allergy_record',
      });
    }

    // ── Duplicate active ingredient ──────────────────────────────────────────
    for (const med of current) {
      const shared = med.ingredients.filter((i) => drugIngredients.has(i.name));
      if (shared.length === 0) continue;

      const label = currentLabels.get(med.query) ?? med.query;
      findings.push({
        items: [drug.query, label],
        severity: 'moderate',
        description: `${drug.query} and ${label} both contain ${shared
          .map((i) => i.name)
          .join(' and ')}. Taking both means taking that ingredient twice.`,
        source: 'rxnorm_ingredient',
      });
    }

    // ── Same therapeutic class ───────────────────────────────────────────────
    const drugClasses = new Map(drug.classes.map((c) => [c.classId, c.className]));
    for (const med of current) {
      const sharedIngredient = med.ingredients.some((i) => drugIngredients.has(i.name));
      if (sharedIngredient) continue; // Already reported as a duplicate ingredient.

      const shared = med.classes.filter((c) => drugClasses.has(c.classId));
      if (shared.length === 0) continue;

      const label = currentLabels.get(med.query) ?? med.query;
      findings.push({
        items: [drug.query, label],
        severity: 'mild',
        description: `${drug.query} and ${label} are both ${shared[0].className.toLowerCase()} (ATC ${
          shared[0].classId
        }). Medicines in the same class often have overlapping effects.`,
        source: 'rxnorm_class',
      });
    }
  }

  return findings;
}

const EXPLANATION_PROMPT = `You are helping a patient understand safety findings that have already been established from their own medical record and from the NIH RxNorm drug database. You are NOT being asked to find interactions — the findings are fixed and listed below.

Write:
1. "summary": a plain-language explanation of what the listed findings mean for this patient, 2-4 sentences. If the list is empty, say plainly that no ingredient duplication, class overlap or allergy match was found among the items checked.
2. "recommendation": one short paragraph on what to do next, always pointing to a pharmacist or doctor.

Hard rules:
- Describe ONLY the findings listed. Never add an interaction, risk or side effect that is not in the list, even if you know of one.
- Never tell the patient to start, stop or change a dose.
- State clearly that drug-drug interaction screening was not performed.
- Plain language, no medical jargon without explanation. The patient may have limited formal education.

Return JSON: { "summary": "...", "recommendation": "..." }`;

async function explainFindings(
  query: string,
  findings: InteractionResult[],
  queriedItems: string[],
  unverified: string[]
): Promise<{ summary: string; recommendation: string }> {
  const fallback = {
    summary:
      findings.length > 0
        ? `${findings.length} finding(s) were identified from your record. See the details listed.`
        : 'No ingredient duplication, drug class overlap or allergy match was found among the items checked.',
    recommendation:
      'Check with your pharmacist or doctor before combining medicines, especially since drug-drug interaction screening was not part of this check.',
  };

  const findingLines =
    findings.length > 0
      ? findings
          .map((f) => `- [${f.severity}] ${f.items.join(' + ')}: ${f.description}`)
          .join('\n')
      : '(none)';

  const context = `Patient asked: ${query}

Items checked: ${queriedItems.join(', ') || 'none'}
${unverified.length > 0 ? `Not found in the drug database, so not checked: ${unverified.join(', ')}\n` : ''}
Established findings:
${findingLines}`;

  try {
    const response = await getGroq().chat.completions.create({
      model: MODELS.primary,
      messages: [
        { role: 'system', content: EXPLANATION_PROMPT },
        { role: 'user', content: context },
      ],
      temperature: 0.2,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return fallback;

    const parsed = explanationSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : fallback;
  } catch (error) {
    console.warn(
      '[Interactions] explanation skipped:',
      error instanceof Error ? error.message : error
    );
    return fallback;
  }
}

export async function checkInteractions(
  userId: string,
  query: string
): Promise<InteractionCheckResponse> {
  const entities = await extractEntities(query);
  const queriedItems = [...entities.drugs, ...entities.foods, ...entities.supplements];

  if (queriedItems.length === 0) {
    return {
      interactions: [],
      summary:
        'No medicines, foods or supplements were identified in your question, so there was nothing to check.',
      recommendation: 'Name the medicine, food or supplement you want checked and try again.',
      unverifiedItems: [],
      limitations: [DDI_LIMITATION],
    };
  }

  const profile = await fetchPatientProfile(userId);
  const activeMeds = profile.medications.filter((m) => m.isActive !== false);

  // Prefer the generic name for resolution; keep the brand name for display.
  const currentLabels = new Map<string, string>();
  const currentNames: string[] = [];
  for (const med of activeMeds) {
    const resolveName = med.genericName ?? med.name;
    currentNames.push(resolveName);
    currentLabels.set(resolveName, med.name);
  }

  const [queriedConcepts, currentConcepts] = await Promise.all([
    resolveDrugConcepts(queriedItems),
    resolveDrugConcepts(currentNames),
  ]);

  const findings = deriveFindings(
    queriedConcepts,
    currentConcepts,
    currentLabels,
    profile.allergies
  );

  // Foods and supplements mostly have no RxNorm concept; say so rather than implying
  // they were cleared.
  const unverifiedItems = queriedConcepts.filter((c) => !c.rxcui).map((c) => c.query);

  const { summary, recommendation } = await explainFindings(
    query,
    findings,
    queriedItems,
    unverifiedItems
  );

  const limitations = [DDI_LIMITATION];
  if (unverifiedItems.length > 0) {
    limitations.push(
      `These were not found in the RxNorm drug database and could not be checked: ${unverifiedItems.join(', ')}.`
    );
  }
  if (activeMeds.length === 0) {
    limitations.push(
      'You have no active medicines recorded, so there was nothing to compare against. Upload your prescriptions to make this check useful.'
    );
  }

  const result: InteractionCheckResponse = {
    interactions: findings,
    summary,
    recommendation,
    unverifiedItems,
    limitations,
  };

  await getDb().insert(interactionChecks).values({
    userId,
    queryText: query,
    itemsChecked: queriedItems,
    results: result as unknown as Record<string, unknown>,
    severity: maxSeverity(findings),
  });

  return result;
}
