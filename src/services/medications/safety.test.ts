import { describe, expect, it } from 'vitest';
import { evaluateMedicationSafety } from './safety';
import { identity, medication } from './test-fixtures';
import type { MedicationAllergy } from './types';

const allergy: MedicationAllergy = {
  id: 'allergy-a', userId: 'synthetic-owner', documentId: 'allergy-doc',
  documentTitle: 'Synthetic allergy note', allergen: 'metformin', reaction: 'documented reaction',
  severity: 'severe', assertionStatus: 'present',
};
const evaluate = (records = [medication()], allergies: MedicationAllergy[] = []) =>
  evaluateMedicationSafety('synthetic-owner', records, allergies, { now: '2026-02-01T00:00:00.000Z' });

describe('explainable medication safety', () => {
  it('separates exact entry duplication and verified ingredient overlap', async () => {
    const records = [medication(), medication({ id: 'med-b' })];
    const result = await evaluate(records);
    expect(result.findings.filter((row) => row.category === 'exact_duplicate')).toHaveLength(1);
    expect(result.findings.filter((row) => row.category === 'ingredient_duplication')).toHaveLength(1);
    expect(result.findings.find((row) => row.category === 'ingredient_duplication')?.severity).toBeNull();
  });

  it('finds overlap across brands, combinations and strengths without calling them equivalent prescriptions', async () => {
    const first = medication();
    const second = medication({
      id: 'med-b', name: 'Synthetic combination', dosage: '1000 mg / 5 mg', documentId: 'doc-b',
      observation: {
        normalization: { ...identity('12345', 'combination'), ingredients: [
          { rxcui: '6809', name: 'metformin' }, { rxcui: '4815', name: 'glyburide' },
        ] },
      },
    });
    const result = await evaluate([first, second]);
    const overlap = result.findings.find((row) => row.category === 'ingredient_duplication');
    expect(overlap?.explanation).toContain('not proof of a prescribing error');
    expect(overlap?.evidence.map((row) => row.documentId)).toEqual(['doc-a', 'doc-b']);
    expect(result.findings.some((row) => row.category === 'exact_duplicate')).toBe(false);
  });

  it('recognizes duplicate imports by full-source fingerprint, not merely equal prescriptions', async () => {
    const first = medication();
    const second = medication({ id: 'med-b', documentId: 'doc-b' });
    expect((await evaluate([first, second])).findings.some((row) => row.category === 'exact_duplicate')).toBe(false);
    first.observation.sourceFingerprint = 'a'.repeat(64);
    second.observation.sourceFingerprint = 'a'.repeat(64);
    expect((await evaluate([first, second])).findings.some((row) => row.category === 'exact_duplicate')).toBe(true);
    second.observation.sourceFingerprint = 'b'.repeat(64);
    expect((await evaluate([first, second])).findings.some((row) => row.category === 'exact_duplicate')).toBe(false);
  });

  it('uses exact allergy names and verified ingredient relationships without inventing severity', async () => {
    const branded = medication({ name: 'Glucophage', observation: { ...medication().observation, originalName: 'Glucophage' } });
    const result = await evaluate([branded], [allergy]);
    const finding = result.findings.find((row) => row.category === 'allergy_concern');
    expect(finding?.certainty).toBe('verified');
    expect(finding?.severity).toBeNull();
    expect(finding?.evidence.find((row) => row.allergyId === allergy.id)?.documentId).toBe('allergy-doc');
  });

  it('does not infer cross-reactivity, use model generic claims or match vague/absent allergies', async () => {
    const drug = medication({ name: 'Amoxicillin', genericName: 'penicillin', observation: { originalName: 'Amoxicillin', normalization: identity('723', 'amoxicillin') } });
    const result = await evaluate([drug], [
      { ...allergy, allergen: 'penicillin' },
      { ...allergy, id: 'vague', allergen: 'antibiotic' },
      { ...allergy, id: 'absent', allergen: 'amoxicillin', assertionStatus: 'absent' },
    ]);
    expect(result.findings.filter((row) => row.category === 'allergy_concern')).toEqual([]);
    expect(result.limitations.join(' ')).toContain('cross-reactivity');
  });

  it('flags missing instructions as documentation issues without requiring every duration', async () => {
    const result = await evaluate([medication({
      dosage: null, frequency: null, duration: null,
      observation: { originalName: 'Metformin', normalization: identity() },
    })]);
    const finding = result.findings.find((row) => row.category === 'missing_information');
    expect(finding?.explanation).toContain('dose, strength, frequency');
    expect(finding?.explanation).not.toContain('duration');
    expect(finding?.explanation).toContain('documentation gap');
  });

  it('distinguishes prescription differences from conflicting confirmed-current instructions', async () => {
    const records = [medication(), medication({ id: 'med-b', documentId: 'doc-b', frequency: 'daily' })];
    expect((await evaluate(records)).findings.some((row) => row.category === 'reconciliation_difference')).toBe(true);
    records.forEach((row) => { row.patientStatus = 'confirmed_current'; });
    expect((await evaluate(records)).findings.some((row) => row.category === 'conflicting_instructions')).toBe(true);
  });

  it('never clears unresolved identities and invalidates old identity after a name correction', async () => {
    const records = [medication({ corrections: { name: 'New patient-reported medicine' } }), medication({ id: 'med-b' })];
    const result = await evaluate(records, [allergy]);
    expect(result.findings.some((row) => row.category === 'uncertain_identity')).toBe(true);
    expect(result.findings.filter((row) => row.category === 'ingredient_duplication')).toHaveLength(0);
    expect(result.findings.filter((row) => row.category === 'allergy_concern')).toHaveLength(1);
  });

  it('does not resurrect an old name or ingredient identity after the patient clears the name', async () => {
    const result = await evaluate([medication({ corrections: { name: null } })], [allergy]);
    expect(result.findings.some((row) => row.category === 'uncertain_identity')).toBe(true);
    expect(result.findings.some((row) => row.category === 'allergy_concern')).toBe(false);
  });

  it('excludes historical, stopped and archived observations from current safety screening', async () => {
    const base = medication();
    const records = [
      medication({ patientStatus: 'historical' }),
      medication({ id: 'med-b', sourceActive: false }),
      medication({ id: 'med-c', observation: { ...base.observation, explicitStop: true, instructions: 'Stop Metformin', excerpt: 'Stop Metformin' } }),
    ];
    const result = await evaluate(records, [allergy]);
    expect(result.findings).toHaveLength(0);
    expect(result.timeline.length).toBeGreaterThan(0);
  });

  it('keeps finding identifiers stable across ordering and evaluation time', async () => {
    const records = [medication(), medication({ id: 'med-b', documentId: 'doc-b', frequency: 'daily' })];
    const first = await evaluate(records);
    const second = await evaluateMedicationSafety('synthetic-owner', [...records].reverse(), [], { now: '2026-03-01T00:00:00.000Z' });
    expect(first.findings.map((row) => row.id)).toEqual(second.findings.map((row) => row.id));
  });

  it('rejects cross-patient medicines and allergies before evaluation', async () => {
    await expect(evaluate([medication({ userId: 'other-owner' })])).rejects.toThrow('scope');
    await expect(evaluate([medication()], [{ ...allergy, userId: 'other-owner' }])).rejects.toThrow('scope');
  });
});
