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
