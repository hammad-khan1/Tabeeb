import { eq, and, desc, inArray, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { getDb } from '@/lib/db';
import {
  documents,
  medications,
  diagnoses,
  labResults,
  allergies,
} from '../../../drizzle/schema';

interface ConditionEntry {
  condition: string;
  icd10Code?: string | null;
  severity?: string | null;
  diagnosedDate?: Date | null;
}

interface MedicationEntry {
  name: string;
  genericName?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  route?: string | null;
  prescribedDate?: Date | null;
}

interface AllergyEntry {
  allergen: string;
  allergyType?: string | null;
  severity?: string | null;
  reaction?: string | null;
}

interface LabResultEntry {
  testName: string;
  value: string;
  numericValue?: number | null;
  unit?: string | null;
  referenceRange?: string | null;
  isAbnormal?: boolean | null;
  testDate: Date;
}

interface TimelineEvent {
  month: string;
  events: Array<{
    date: Date;
    type: string;
    title: string;
    hospital?: string | null;
    doctorName?: string | null;
  }>;
}

export interface MedicalHistorySummary {
  conditions: ConditionEntry[];
  currentMedications: MedicationEntry[];
  allergies: AllergyEntry[];
  recentLabResults: LabResultEntry[];
  visitTimeline: TimelineEvent[];
  documentCount: number;
  /** True when the summary was limited to a subset of documents, e.g. a scoped share. */
  isPartial: boolean;
}

/**
 * When `documentIds` is given, EVERY section is restricted to those documents — not
 * just the timeline. Scoping only the timeline (as this previously did for shares)
 * meant a patient sharing one lab report handed over their entire medication list,
 * diagnoses and allergies.
 */
export async function getMedicalHistorySummary(
  userId: string,
  documentIds?: string[]
): Promise<MedicalHistorySummary> {
  const scoped = documentIds !== undefined;

  // An explicit empty scope must return nothing, not silently widen to everything.
  if (scoped && documentIds.length === 0) {
    return {
      conditions: [],
      currentMedications: [],
      allergies: [],
      recentLabResults: [],
      visitTimeline: [],
      documentCount: 0,
      isPartial: true,
    };
  }

  const scopeBy = (column: AnyPgColumn): SQL | undefined =>
    scoped ? inArray(column, documentIds) : undefined;

  const [docs, meds, diags, labs, allergyRows] = await Promise.all([
    getDb()
      .select()
      .from(documents)
      .where(and(eq(documents.userId, userId), scopeBy(documents.id)))
      .orderBy(desc(documents.documentDate)),
    getDb()
      .select()
      .from(medications)
      .where(
        and(
          eq(medications.userId, userId),
          eq(medications.isActive, true),
          scopeBy(medications.documentId)
        )
      ),
    getDb()
      .select()
      .from(diagnoses)
      .where(and(eq(diagnoses.userId, userId), scopeBy(diagnoses.documentId)))
      .orderBy(desc(diagnoses.diagnosedDate)),
    getDb()
      .select()
      .from(labResults)
      .where(and(eq(labResults.userId, userId), scopeBy(labResults.documentId)))
      .orderBy(desc(labResults.testDate)),
    getDb()
      .select()
      .from(allergies)
      .where(and(eq(allergies.userId, userId), scopeBy(allergies.documentId))),
  ]);

  const conditions: ConditionEntry[] = diags.map((d) => ({
    condition: d.condition,
    icd10Code: d.icd10Code,
    severity: d.severity,
    diagnosedDate: d.diagnosedDate,
  }));

  const currentMedications: MedicationEntry[] = meds.map((m) => ({
    name: m.name,
    genericName: m.genericName,
    dosage: m.dosage,
    frequency: m.frequency,
    route: m.route,
    prescribedDate: m.prescribedDate,
  }));

  const allergyEntries: AllergyEntry[] = allergyRows.map((a) => ({
    allergen: a.allergen,
    allergyType: a.allergyType,
    severity: a.severity,
    reaction: a.reaction,
  }));

  const latestLabMap = new Map<string, LabResultEntry>();
  for (const l of labs) {
    const key = l.testName.toLowerCase();
    if (!latestLabMap.has(key)) {
      latestLabMap.set(key, {
        testName: l.testName,
        value: l.value,
        numericValue: l.numericValue,
        unit: l.unit,
        referenceRange: l.referenceRange,
        isAbnormal: l.isAbnormal,
        testDate: l.testDate,
      });
    }
  }
  const recentLabResults = Array.from(latestLabMap.values());

  const timelineMap = new Map<string, TimelineEvent['events']>();
  for (const doc of docs) {
    const date = doc.documentDate ?? doc.createdAt;
    if (!date) continue;
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!timelineMap.has(monthKey)) {
      timelineMap.set(monthKey, []);
    }
    timelineMap.get(monthKey)!.push({
      date,
      type: doc.documentType,
      title: doc.title,
      hospital: doc.hospital,
      doctorName: doc.doctorName,
    });
  }

  const visitTimeline: TimelineEvent[] = Array.from(timelineMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, events]) => ({
      month,
      events: events.sort((a, b) => b.date.getTime() - a.date.getTime()),
    }));

  return {
    conditions,
    currentMedications,
    allergies: allergyEntries,
    recentLabResults,
    visitTimeline,
    documentCount: docs.length,
    isPartial: scoped,
  };
}
