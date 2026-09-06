import { describe, it, expect } from 'vitest';
import {
  detectAssertion,
  detectAssertions,
  isNegated,
  belongsToPatient,
  describeAssertion,
} from './assertion';

describe('negation', () => {
  it('marks an explicitly denied condition absent', () => {
    expect(detectAssertion('No history of diabetes.', 'diabetes').status).toBe('absent');
    expect(isNegated('Patient denies chest pain.', 'chest pain')).toBe(true);
  });

  it('reads a trailing negation', () => {
    expect(detectAssertion('Tuberculosis was ruled out.', 'tuberculosis').status).toBe('absent');
  });

  it('stops at a termination cue so the second clause is unaffected', () => {
    const text = 'No chest pain but complains of fever.';
    expect(detectAssertion(text, 'chest pain').status).toBe('absent');
    expect(detectAssertion(text, 'fever').status).toBe('present');
  });

  it('does not treat past history as denial', () => {
    expect(detectAssertion('History of hepatitis B in 2015.', 'hepatitis').status).toBe(
      'historical'
    );
  });
});

describe('other assertion types', () => {
  it('attributes a relative’s condition to the family', () => {
    expect(detectAssertion('Family history of diabetes.', 'diabetes').status).toBe('family');
    expect(detectAssertion('Father had a heart attack at 50.', 'heart attack').status).toBe(
      'family'
    );
  });

  it('recognises conditional advice as hypothetical', () => {
    expect(detectAssertion('Return to the clinic if you develop fever.', 'fever').status).toBe(
      'hypothetical'
    );
  });

  it('recognises hedged findings as uncertain', () => {
    expect(detectAssertion('Impression: possible tuberculosis.', 'tuberculosis').status).toBe(
      'uncertain'
    );
  });
});

describe('multilingual cues', () => {
  it('reads an Urdu negation', () => {
    expect(detectAssertion('مریض کو شوگر نہیں ہے', 'diabetes').status).toBe('absent');
  });

  it('reads a Roman-Urdu negation', () => {
    expect(detectAssertion('mujhe sugar nahi hai', 'diabetes').status).toBe('absent');
  });

  it('reads an Urdu family attribution', () => {
    expect(detectAssertion('والد کو شوگر تھی', 'diabetes').status).toBe('family');
  });
});

describe('aggregation and defaults', () => {
  it('lets a plain statement outweigh a hedge elsewhere', () => {
    const text = 'Family history of diabetes. Patient has diabetes since 2019.';
    expect(detectAssertion(text, 'diabetes').status).toBe('present');
  });

  it('defaults to present when the term is not literally in the text', () => {
    const assertion = detectAssertion('Blood pressure 130/85.', 'Type 2 diabetes mellitus');
    expect(assertion.status).toBe('present');
    expect(assertion.evidence).toBe('');
  });

  it('matches a multi-word condition on its longest word', () => {
    expect(
      detectAssertion('No evidence of pulmonary tuberculosis.', 'pulmonary tuberculosis').status
    ).toBe('absent');
  });

  it('classifies a batch of terms in one pass', () => {
    const text = 'No diabetes. Father had asthma. Patient has hypertension.';
    const result = detectAssertions(text, ['diabetes', 'asthma', 'hypertension']);
    expect(result.get('diabetes')?.status).toBe('absent');
    expect(result.get('asthma')?.status).toBe('family');
    expect(result.get('hypertension')?.status).toBe('present');
  });
});

describe('reporting', () => {
  it('keeps present, historical and uncertain findings on the patient', () => {
    expect(belongsToPatient('present')).toBe(true);
    expect(belongsToPatient('historical')).toBe(true);
    expect(belongsToPatient('uncertain')).toBe(true);
    expect(belongsToPatient('absent')).toBe(false);
    expect(belongsToPatient('family')).toBe(false);
    expect(belongsToPatient('hypothetical')).toBe(false);
  });

  it('explains a held-back finding and says nothing about a normal one', () => {
    const absent = detectAssertion('No history of diabetes.', 'diabetes');
    expect(describeAssertion(absent)).toContain('do not have it');
    expect(describeAssertion({ term: 'x', status: 'present', cue: null, evidence: '' })).toBeNull();
  });
});

describe('a relative as informant, not subject', () => {
  // "Mother reports the patient has asthma" is the PATIENT's asthma. The bare relative
  // cue read it as family history, and family findings are dropped from the record —
  // so a real diagnosis vanished. Paediatric and geriatric notes read this way often.
  it.each([
    'Mother reports the patient has asthma.',
    'Father says the patient has asthma.',
    'The mother stated the patient has asthma.',
    'Mother brought the patient with asthma.',
    'Father complained the patient has asthma.',
  ])('keeps the finding with the patient: %s', (text) => {
    const result = detectAssertion(text, 'asthma');
    expect(result.status).toBe('present');
    expect(belongsToPatient(result.status)).toBe(true);
  });

  it.each([
    ['Father had diabetes.', 'diabetes'],
    ['Family history of hypertension.', 'hypertension'],
    ['Mother and sister both have thyroid disease.', 'thyroid disease'],
    ['Paternal uncle has tuberculosis.', 'tuberculosis'],
  ])('still attributes a genuine family history: %s', (text, term) => {
    expect(detectAssertion(text, term).status).toBe('family');
  });
});

describe('a document that contradicts itself', () => {
  // A plain mention used to override an explicit denial outright, because 'present'
  // outranked everything — so a screening order beat the line saying the patient does
  // not have the condition. That is the failure this module exists to prevent.
  const CONTRADICTORY = 'No history of diabetes. Advised annual diabetes screening.';

  it('does not let a bare mention override an explicit denial', () => {
    expect(detectAssertion(CONTRADICTORY, 'diabetes').status).not.toBe('present');
  });

  it('resolves to uncertain rather than picking a side', () => {
    expect(detectAssertion(CONTRADICTORY, 'diabetes').status).toBe('uncertain');
  });

  it('keeps the finding in the record rather than dropping it', () => {
    // Discarding a condition the document states plainly is its own kind of harm.
    expect(belongsToPatient(detectAssertion(CONTRADICTORY, 'diabetes').status)).toBe(true);
  });

  it('carries both sentences so the patient can see the conflict', () => {
    const result = detectAssertion(CONTRADICTORY, 'diabetes');
    expect(result.contradiction?.denied).toMatch(/No history of diabetes/i);
    expect(result.contradiction?.asserted).toMatch(/screening/i);
  });

  it('tells the patient plainly, and points at the doctor', () => {
    const note = describeAssertion(detectAssertion(CONTRADICTORY, 'diabetes'))!;
    expect(note).toMatch(/written both ways/i);
    expect(note).toMatch(/not as a confirmed finding/i);
    expect(note).toMatch(/check with your doctor/i);
  });

  it('handles a denial followed by treatment for the same thing', () => {
    const result = detectAssertion('No evidence of TB. Started on TB treatment.', 'TB');
    expect(result.status).toBe('uncertain');
    expect(result.contradiction).toBeDefined();
  });

  it('leaves an uncontradicted denial alone', () => {
    const result = detectAssertion('No history of diabetes.', 'diabetes');
    expect(result.status).toBe('absent');
    expect(result.contradiction).toBeUndefined();
  });
});

