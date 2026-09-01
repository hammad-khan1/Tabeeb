import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { groq, MODELS } from '@/lib/groq';
import {
  medications,
  allergies,
  interactionChecks,
} from '../../../drizzle/schema';
import { getDrugInteractionsForNames } from './rxnav-client';

interface InteractionResult {
  items: string[];
  severity: 'info' | 'mild' | 'moderate' | 'severe' | 'contraindicated';
  description: string;
}

interface InteractionCheckResponse {
  interactions: InteractionResult[];
  summary: string;
  recommendation: string;
}

const ENTITY_EXTRACTION_PROMPT = `Extract all drug names, food items, and supplements mentioned in the user's query. Return JSON with this exact structure:
{ "drugs": ["name1", "name2"], "foods": ["food1"], "supplements": ["supp1"] }
Only include items explicitly mentioned. Return empty arrays if none found.`;

const SYNTHESIS_PROMPT = `You are a clinical pharmacist AI. Given the patient's current medications, allergies, and interaction check results, provide patient-specific safety advice.

Patient medications: {medications}
Patient allergies: {allergies}

Interaction data from NIH RxNav:
{interactionData}

Queried items: {queriedItems}

Provide:
1. A list of interactions found with severity (info/mild/moderate/severe/contraindicated)
2. A plain-language summary of what this means for the patient
3. A clear recommendation (what to avoid, what to discuss with doctor)

Return JSON:
{
  "interactions": [{ "items": ["drug1", "drug2"], "severity": "moderate", "description": "..." }],
  "summary": "...",
  "recommendation": "..."
}`;

async function extractEntities(query: string): Promise<{ drugs: string[]; foods: string[]; supplements: string[] }> {
  const response = await groq.chat.completions.create({
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
  if (!content) return { drugs: [], foods: [], supplements: [] };

  try {
    return JSON.parse(content);
  } catch {
    return { drugs: [], foods: [], supplements: [] };
  }
}

async function fetchPatientProfile(userId: string) {
  const [medRows, allergyRows] = await Promise.all([
    getDb()      .select({
        name: medications.name,
        genericName: medications.genericName,
        dosage: medications.dosage,
        frequency: medications.frequency,
      })
      .from(medications)
      .where(eq(medications.userId, userId)),
    getDb()      .select({
        allergen: allergies.allergen,
        severity: allergies.severity,
      })
      .from(allergies)
      .where(eq(allergies.userId, userId)),
  ]);

  return {
    medications: medRows,
    allergies: allergyRows,
  };
}

function determineMaxSeverity(interactions: InteractionResult[]): InteractionResult['severity'] {
  const severityOrder: Record<string, number> = {
    info: 0,
    mild: 1,
    moderate: 2,
    severe: 3,
    contraindicated: 4,
  };

  let max = 'info' as InteractionResult['severity'];
  for (const interaction of interactions) {
    if ((severityOrder[interaction.severity] ?? 0) > (severityOrder[max] ?? 0)) {
      max = interaction.severity;
    }
  }
  return max;
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
      summary: 'No drugs, foods, or supplements were identified in your query to check for interactions.',
      recommendation: 'Please specify the drug, food, or supplement names you want to check.',
    };
  }

  const profile = await fetchPatientProfile(userId);
  const medNames = profile.medications.map(
    (m) => m.genericName ?? m.name
  );

  const allItemsToCheck = [...new Set([...medNames, ...queriedItems])];
  const rxnavResults = await getDrugInteractionsForNames(allItemsToCheck);

  const interactionDataStr = Array.from(rxnavResults.entries())
    .map(([drug, groups]) => {
      const details = groups
        .flatMap((g) =>
          g.interactions.map(
            (i) => `  - interacts with ${i.name} (severity: ${i.severity}): ${i.description}`
          )
        )
        .join('\n');
      return `${drug}:\n${details || '  No interactions found'}`;
    })
    .join('\n\n');

  const medList = profile.medications
    .map((m) => `${m.name}${m.dosage ? ` ${m.dosage}` : ''}${m.frequency ? ` ${m.frequency}` : ''}`)
    .join(', ') || 'None recorded';

  const allergyList = profile.allergies
    .map((a) => `${a.allergen}${a.severity ? ` (${a.severity})` : ''}`)
    .join(', ') || 'None recorded';

  const synthPrompt = SYNTHESIS_PROMPT
    .replace('{medications}', medList)
    .replace('{allergies}', allergyList)
    .replace('{interactionData}', interactionDataStr || 'No interaction data available from RxNav.')
    .replace('{queriedItems}', queriedItems.join(', '));

  const synthResponse = await groq.chat.completions.create({
    model: MODELS.primary,
    messages: [
      { role: 'system', content: synthPrompt },
      { role: 'user', content: `Patient query: ${query}` },
    ],
    temperature: 0.2,
    max_tokens: 2048,
    response_format: { type: 'json_object' },
  });

  const synthContent = synthResponse.choices[0]?.message?.content;
  let result: InteractionCheckResponse;

  if (synthContent) {
    try {
      result = JSON.parse(synthContent) as InteractionCheckResponse;
    } catch {
      result = {
        interactions: [],
        summary: 'Unable to parse interaction analysis. Please try again.',
        recommendation: 'Consult your pharmacist or doctor about potential interactions.',
      };
    }
  } else {
    result = {
      interactions: [],
      summary: 'No response generated. Please try again.',
      recommendation: 'Consult your pharmacist or doctor about potential interactions.',
    };
  }

  const maxSeverity = determineMaxSeverity(result.interactions);

  await getDb().insert(interactionChecks).values({
    userId,
    queryText: query,
    itemsChecked: queriedItems,
    results: result as unknown as Record<string, unknown>,
    severity: maxSeverity,
  });

  return result;
}
