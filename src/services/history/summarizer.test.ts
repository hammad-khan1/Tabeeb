import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression guard for the finding that a scoped share leaked the whole record:
 * `getFilteredHistory` applied the caller's documentIds to the visit timeline only,
 * and passed conditions, medications, allergies and labs straight through from the
 * unscoped summary. A patient sharing one lab report handed over everything.
 *
 * `inArray` is spied on so the test asserts which *columns* actually get scoped —
 * checking merely that a WHERE exists would pass on the buggy code too, since every
 * query already filtered by userId.
 */

const scopedColumns: string[] = [];

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    inArray: (column: { name?: string }, values: unknown[]) => {
      scopedColumns.push(String(column?.name ?? 'unknown'));
      return actual.inArray(column as never, values as never);
    },
  };
});

const queriedTables: string[] = [];

/** Limits the summarizer asked for, per table, so the caps can be asserted. */
const appliedLimits = new Map<string, number>();

/**
 * Fully fluent: every builder method returns the chain and only awaiting resolves it.
 * An earlier version terminated at `orderBy`, so adding `.limit()` to the production
 * queries broke thirteen tests that were not about limits at all.
 */
function makeSelectChain(table: string, rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => {
      queriedTables.push(table);
      return chain;
    },
    orderBy: () => chain,
    limit: (n: number) => {
      appliedLimits.set(table, n);
      return chain;
    },
    offset: () => chain,
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

/** The order the summarizer issues its queries in. */
const TABLE_SEQUENCE = ['documents', 'medications', 'diagnoses', 'labResults', 'allergies'];
let callIndex = 0;

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    select: () => {
      const table = TABLE_SEQUENCE[callIndex] ?? 'unknown';
      callIndex += 1;
      return makeSelectChain(table, []);
    },
  }),
}));

const { getMedicalHistorySummary } = await import('./summarizer');

beforeEach(() => {
  scopedColumns.length = 0;
  queriedTables.length = 0;
  appliedLimits.clear();
  callIndex = 0;
});

describe('getMedicalHistorySummary', () => {
  it('queries every clinical table', async () => {
    await getMedicalHistorySummary('user_1');
    expect(queriedTables).toEqual(TABLE_SEQUENCE);
  });

  it('applies no document scope when none is requested', async () => {
    const result = await getMedicalHistorySummary('user_1');

    expect(scopedColumns).toEqual([]);
    expect(result.isPartial).toBe(false);
  });

  it('scopes every clinical table by document, not just the timeline', async () => {
    await getMedicalHistorySummary('user_1', ['11111111-1111-1111-1111-111111111111']);

    // On the buggy version only `documents.id` was ever scoped, so the four entity
    // tables returned the patient's entire record regardless of the share's scope.
    expect(scopedColumns).toEqual(['id', 'document_id', 'document_id', 'document_id', 'document_id']);
    expect(scopedColumns).toHaveLength(TABLE_SEQUENCE.length);
  });

  it('marks a scoped summary as partial so the reader knows it is incomplete', async () => {
    const result = await getMedicalHistorySummary('user_1', ['doc-1']);
    expect(result.isPartial).toBe(true);
  });

  it('returns nothing for an explicitly empty scope instead of widening', async () => {
    const result = await getMedicalHistorySummary('user_1', []);

    expect(result.isPartial).toBe(true);
    expect(result.documentCount).toBe(0);
    expect(result.conditions).toEqual([]);
    expect(result.currentMedications).toEqual([]);
    expect(result.allergies).toEqual([]);
    expect(result.recentLabResults).toEqual([]);
    // No query should run at all — an empty IN () must not fall back to "everything".
    expect(queriedTables).toEqual([]);
  });
});

describe('row caps', () => {
  // None of these queries had a limit, and this is the app's most-used read path:
  // the dashboard, the history page, and every share link handed to a doctor.
  it('caps every clinical table it reads', async () => {
    await getMedicalHistorySummary('u1');

    for (const table of ['documents', 'medications', 'diagnoses', 'labResults', 'allergies']) {
      expect(appliedLimits.get(table), `${table} has no limit`).toBeGreaterThan(0);
    }
  });

  it('leaves room for a real history rather than truncating to a handful', () => {
    // A cap so tight it hides a patient's record is its own bug.
    for (const [, limit] of appliedLimits) expect(limit).toBeGreaterThanOrEqual(50);
  });
});

