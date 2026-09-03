const RXNAV_BASE = 'https://rxnav.nlm.nih.gov/REST';

interface InteractionItem {
  rxcui: string;
  name: string;
  severity: string;
  description: string;
}

interface InteractionGroup {
  sourceName: string;
  interactions: InteractionItem[];
}

/** Partial shape of the RxNav interaction.json response — only the fields consumed here. */
interface RxNavInteractionPair {
  severity?: string;
  description?: string;
  interactionConceptGroup?: Array<{ minConceptItem?: { rxcui?: string; name?: string } }>;
}

interface RxNavFullInteractionGroup {
  interactionPair?: RxNavInteractionPair[];
}

interface RxNavInteractionTypeGroup {
  sourceName?: string;
  fullInteractionGroup?: RxNavFullInteractionGroup[];
}

export async function getRxNormId(drugName: string): Promise<string | null> {
  try {
    const url = `${RXNAV_BASE}/rxcui?idtype=names&term=${encodeURIComponent(drugName)}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const group = data?.idGroup?.rxnormId;
    if (!group || group.length === 0) return null;

    return group[0];
  } catch {
    return null;
  }
}

export async function getDrugInteractions(rxcui: string): Promise<InteractionGroup[]> {
  try {
    const url = `${RXNAV_BASE}/interaction/interaction.json?rxcui=${encodeURIComponent(rxcui)}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) return [];

    const data = await response.json();
    const groups = data?.fullInteractionTypeGroup;
    if (!groups || !Array.isArray(groups)) return [];

    return groups.flatMap((group: RxNavInteractionTypeGroup) => {
      const sourceName = group?.sourceName ?? 'Unknown';
      const interactions = (group?.fullInteractionGroup ?? []).flatMap(
        (fg: RxNavFullInteractionGroup) =>
          (fg?.interactionPair ?? []).map((pair: RxNavInteractionPair) => ({
            rxcui: pair?.interactionConceptGroup?.[0]?.minConceptItem?.rxcui ?? '',
            name: pair?.interactionConceptGroup?.[0]?.minConceptItem?.name ?? '',
            severity: pair?.severity ?? 'N/A',
            description: pair?.description ?? 'No description available.',
          }))
      );
      return [{ sourceName, interactions }];
    });
  } catch {
    return [];
  }
}

export async function getDrugInteractionsForNames(
  drugNames: string[]
): Promise<Map<string, InteractionGroup[]>> {
  const results = new Map<string, InteractionGroup[]>();

  const lookups = await Promise.all(
    drugNames.map(async (name) => {
      const rxcui = await getRxNormId(name);
      if (!rxcui) return { name, groups: [] };
      const groups = await getDrugInteractions(rxcui);
      return { name, groups };
    })
  );

  for (const { name, groups } of lookups) {
    results.set(name, groups);
  }

  return results;
}
