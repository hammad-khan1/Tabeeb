import { describe, expect, it } from 'vitest';
import { buildMedicationTimeline, comparePrescriptions, exactSourceDate, medicationStatus } from './reconciliation';
import { medication } from './test-fixtures';

describe('conservative longitudinal reconciliation', () => {
  it('reports frequency and duration changes with both sources without choosing a prescription', () => {
    const first = medication();
    const second = medication({ id: 'med-b', documentId: 'doc-b', documentDate: '2026-02-01', frequency: 'daily', duration: '7 days' });
    first.duration = '5 days';
    const result = comparePrescriptions([second, first], 'doc-a', 'doc-b');
    expect(result.differences.map((row) => row.field)).toEqual(['frequency', 'duration']);
    expect(result.differences[0].evidence.map((row) => row.documentId)).toEqual(['doc-a', 'doc-b']);
    expect(result.differences[0].explanation).toContain('neither source');
  });

  it('does not infer discontinuation from omission in a newer prescription', () => {
    const first = medication();
    const other = medication({ id: 'other', documentId: 'doc-b', name: 'UnknownBrand', observation: { originalName: 'UnknownBrand' } });
    const comparison = comparePrescriptions([first, other], 'doc-a', 'doc-b');
    expect(comparison.onlyInFirst).toEqual(['med-a']);
    expect(buildMedicationTimeline(first.userId, [first, other]).some((row) => row.type === 'explicit_discontinuation')).toBe(false);
    expect(medicationStatus(first)).toBe('prescribed_unconfirmed');
  });

  it('is stable when documents arrive out of date order', () => {
    const first = medication();
    const second = medication({ id: 'med-b', documentId: 'doc-b', documentDate: '2026-02-01', dosage: '1000 mg' });
    expect(buildMedicationTimeline(first.userId, [second, first]))
      .toEqual(buildMedicationTimeline(first.userId, [first, second]));
  });

  it('requires source support for a stop and rejects negated stop instructions', () => {
    const base = medication();
    const stopped = medication({ observation: { ...base.observation, explicitStop: true, instructions: 'Stop Metformin.', excerpt: 'Stop Metformin.' } });
    expect(medicationStatus(stopped)).toBe('discontinued');
    expect(buildMedicationTimeline(stopped.userId, [stopped]).some((row) => row.type === 'explicit_discontinuation')).toBe(true);
    stopped.observation.instructions = 'Do not stop Metformin';
    stopped.observation.excerpt = 'Do not stop Metformin';
    expect(medicationStatus(stopped)).toBe('prescribed_unconfirmed');
  });

  it('does not fabricate dates for partial dates or patient actions', () => {
    const record = medication({ documentDate: 'March 2026', patientStatus: 'confirmed_current', updatedAt: '2026-05-01T00:00:00.000Z' });
    expect(exactSourceDate(record.documentDate)).toBeNull();
    expect(exactSourceDate('2026-02-30')).toBeNull();
    const timeline = buildMedicationTimeline(record.userId, [record]);
    expect(timeline.find((row) => row.type === 'first_documented')?.date).toBe('March 2026');
    expect(timeline.find((row) => row.type === 'patient_confirmation')?.date).toBeNull();
  });

  it('preserves approximate prescription dates even when the document has an exact date', () => {
    const record = medication({ observation: { ...medication().observation, prescribedDateText: '2025-04' } });
    expect(buildMedicationTimeline(record.userId, [record])[0].date).toBe('2025-04');
  });

  it('detects tablet-count changes and does not imply chronology for undated sources', () => {
    const first = medication({ documentDate: null });
    const second = medication({
      id: 'med-b', documentId: 'doc-b', documentDate: 'March 2026',
      observation: { ...first.observation, doseAmount: '2 tablets' },
    });
    expect(comparePrescriptions([first, second], 'doc-a', 'doc-b').differences[0].field).toBe('doseAmount');
    const event = buildMedicationTimeline(first.userId, [first, second]).find((row) => row.type === 'dose_change');
    expect(event?.description).toContain('One source');
    expect(event?.description).not.toContain('→');
  });

  it('compares original instructions after patient corrections and preserves original evidence', () => {
    const first = medication({ corrections: { frequency: 'daily' } });
    const second = medication({ id: 'med-b', documentId: 'doc-b', frequency: 'three times daily' });
    expect(comparePrescriptions([first, second], 'doc-a', 'doc-b').differences[0].before).toBe('twice daily');
    expect(first.frequency).toBe('twice daily');
    expect(first.observation.excerpt).toContain('twice daily');
  });

  it('never treats a model current-use assertion as patient confirmation', () => {
    expect(medicationStatus(medication({ observation: { status: 'confirmed_current' } }))).toBe('unknown');
  });

  it('rejects records from another patient', () => {
    expect(() => buildMedicationTimeline('other-owner', [medication()])).toThrow('scope');
    expect(() => comparePrescriptions([medication(), medication({ id: 'other', userId: 'other' })], 'doc-a', 'doc-b')).toThrow('scope');
  });
});
