import { parseMedicalValue, isOutOfRange, type Censoring } from '@/lib/medical-values';
import { canonicalizeLab } from '@/services/nlp/lab-normalizer';

export interface ParsedLabResult {
  testName: string;
  /** Catalogue display name where the analyte is known, else the verbatim reading. */
  displayName: string;
  value: string;
  numericValue: number | null;
  /** Set when the report gave a bound ("<5.7") rather than a measurement. */
  censoring: Censoring;
  unit: string | null;
  referenceRange: string | null;
  isAbnormal: boolean;
  /** null when the range could not be read — distinct from "known to be normal". */
  abnormalityKnown: boolean;
  testDate: string | null;
  canonicalTestName: string | null;
  canonicalValue: number | null;
  canonicalUnit: string | null;
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

export function parseLabResults(structuredData: unknown): ParsedLabResult[] {
  if (!structuredData) return [];

  const labResults: RawLabEntry[] = Array.isArray(structuredData)
    ? structuredData
    : ((structuredData as { labResults?: RawLabEntry[] }).labResults ?? []);

  if (!Array.isArray(labResults)) return [];

  return labResults
    .filter((entry): entry is RawLabEntry & { testName: string } =>
      Boolean(entry && typeof entry === 'object' && entry.testName)
    )
    .map((entry): ParsedLabResult => {
      // Parse the printed value first: the model's numericValue can be a rounded or
      // truncated reading of it, and the string carries censoring the number cannot.
      const fromText = parseMedicalValue(entry.value);
      const fromModel = parseMedicalValue(entry.numericValue);

      const numericValue = fromText?.value ?? fromModel?.value ?? null;
      const censoring = fromText?.censoring ?? null;
      const referenceRange = entry.referenceRange ?? null;
      const unit = entry.unit ?? null;

      // Only trust an explicit flag from the report; otherwise derive it, and record
      // when it could not be derived rather than defaulting to "normal".
      const derived = isOutOfRange(numericValue, referenceRange);
      const isAbnormal = entry.isAbnormal ?? derived ?? false;
      const abnormalityKnown = entry.isAbnormal !== undefined || derived !== null;

      const canonical = canonicalizeLab(entry.testName, numericValue, unit);

      return {
        testName: entry.testName,
        displayName: canonical.displayName,
        value: entry.value ?? (numericValue !== null ? String(numericValue) : ''),
        numericValue,
        censoring,
        unit,
        referenceRange,
        isAbnormal,
        abnormalityKnown,
        testDate: entry.testDate ?? null,
        canonicalTestName: canonical.canonicalTestName,
        canonicalValue: canonical.canonicalValue,
        canonicalUnit: canonical.canonicalUnit,
      };
    });
}

/**
 * Groups by canonical analyte so "HbA1c", "HBA1C" and "Glycated Haemoglobin" form one
 * series. An analyte outside the catalogue falls back to its normalized raw name,
 * which at least still merges case and spacing variants.
 */
export function groupByTest(results: ParsedLabResult[]): Map<string, ParsedLabResult[]> {
  const groups = new Map<string, ParsedLabResult[]>();

  for (const result of results) {
    const key = result.canonicalTestName ?? result.testName.toLowerCase().trim();
    const existing = groups.get(key) ?? [];
    existing.push(result);
    groups.set(key, existing);
  }

  return groups;
}
