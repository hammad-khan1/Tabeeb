interface ParsedLabResult {
  testName: string;
  value: string;
  numericValue: number | null;
  unit: string | null;
  referenceRange: string | null;
  isAbnormal: boolean;
  testDate: string | null;
}

/** Raw lab entry as produced by the extraction LLM — every field is untrusted. */
interface RawLabEntry {
  testName?: string;
  value?: string;
  numericValue?: number | null;
  unit?: string | null;
  referenceRange?: string | null;
  isAbnormal?: boolean;
  testDate?: string | null;
}

function parseNumericValue(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[<>=]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function isOutOfRange(numericValue: number | null, referenceRange: string | null): boolean {
  if (numericValue === null || !referenceRange) return false;

  const match = referenceRange.match(/([\d.]+)\s*[-–—]\s*([\d.]+)/);
  if (!match) return false;

  const min = parseFloat(match[1]);
  const max = parseFloat(match[2]);
  return numericValue < min || numericValue > max;
}

export function parseLabResults(structuredData: unknown): ParsedLabResult[] {
  if (!structuredData) return [];

  const labResults: RawLabEntry[] = Array.isArray(structuredData)
    ? structuredData
    : ((structuredData as { labResults?: RawLabEntry[] }).labResults ?? []);

  return labResults
    .filter((entry): entry is RawLabEntry & { testName: string } =>
      Boolean(entry && entry.testName)
    )
    .map((entry): ParsedLabResult => {
      const numericValue = entry.numericValue ?? parseNumericValue(entry.value ?? '');
      const referenceRange = entry.referenceRange ?? null;

      return {
        testName: entry.testName,
        value: entry.value ?? String(entry.numericValue ?? ''),
        numericValue,
        unit: entry.unit ?? null,
        referenceRange,
        isAbnormal: entry.isAbnormal ?? isOutOfRange(numericValue, referenceRange),
        testDate: entry.testDate ?? null,
      };
    });
}

export function groupByTest(results: ParsedLabResult[]): Map<string, ParsedLabResult[]> {
  const groups = new Map<string, ParsedLabResult[]>();

  for (const result of results) {
    const key = result.testName.toLowerCase().trim();
    const existing = groups.get(key) ?? [];
    existing.push(result);
    groups.set(key, existing);
  }

  return groups;
}
