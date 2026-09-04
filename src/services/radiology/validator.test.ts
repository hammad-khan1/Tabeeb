import { describe, it, expect } from 'vitest';
import { buildFindings, buildImagingNote } from './validator';
import {
  selectFlagged,
  isDiscriminating,
  type ClassificationResult,
  type PathologyScore,
} from './classifier';

/**
 * These guard the correction to the X-ray path: findings must come from a classifier's
 * probabilities, and the app must never let silence read as "your X-ray is clear".
 */

function result(scores: PathologyScore[], unavailableReason?: string): ClassificationResult {
  return {
    scores,
    flagged: unavailableReason ? [] : selectFlagged(scores),
    modelId: 'test-model',
    unavailableReason,
  };
}

describe('selectFlagged', () => {
  it('flags a confident finding', () => {
    const f = selectFlagged([{ pathology: 'Effusion', probability: 0.82 }]);
    expect(f).toHaveLength(1);
  });

  it('does not flag a low-probability routine finding', () => {
    expect(selectFlagged([{ pathology: 'Emphysema', probability: 0.2 }])).toHaveLength(0);
  });

  it('flags a time-critical finding at a lower threshold', () => {
    // A pneumothorax the patient never mentions to a doctor is worse than one extra
    // conversation, so these surface earlier — always labelled as needing confirmation.
    expect(selectFlagged([{ pathology: 'Pneumothorax', probability: 0.4 }])).toHaveLength(1);
    expect(selectFlagged([{ pathology: 'Atelectasis', probability: 0.4 }])).toHaveLength(0);
  });

  it('orders by probability', () => {
    const f = selectFlagged([
      { pathology: 'Effusion', probability: 0.6 },
      { pathology: 'Pneumonia', probability: 0.9 },
    ]);
    expect(f.map((s) => s.pathology)).toEqual(['Pneumonia', 'Effusion']);
  });
});

describe('buildFindings', () => {
  it('carries the model probability through as the confidence', () => {
    const [f] = buildFindings(result([{ pathology: 'Pneumonia', probability: 0.77 }]));
    expect(f.confidence).toBe(77);
    expect(f.finding).toBe('Pneumonia');
  });

  it('never marks a finding as clinically validated', () => {
    // The old code set validated: true on LLM-invented findings, asserting a review
    // that had not happened.
    for (const f of buildFindings(result([{ pathology: 'Mass', probability: 0.9 }]))) {
      expect(f.validated).toBe(false);
    }
  });

  it('states that it is not a diagnosis on every finding', () => {
    const [f] = buildFindings(result([{ pathology: 'Fracture', probability: 0.8 }]));
    expect(f.validationNotes).toMatch(/not a diagnosis/i);
    expect(f.validationNotes).toMatch(/confirmed by a doctor/i);
  });

  it('escalates a pneumothorax to critical', () => {
    const [f] = buildFindings(result([{ pathology: 'Pneumothorax', probability: 0.7 }]));
    expect(f.urgencyLevel).toBe('critical');
    expect(f.severity).toBe('critical');
  });

  it('describes the finding in plain language, not jargon', () => {
    const [f] = buildFindings(result([{ pathology: 'Pneumothorax', probability: 0.7 }]));
    expect(f.description).toMatch(/collapsed lung/i);
  });

  it('produces nothing when the classifier was unavailable', () => {
    expect(buildFindings(result([], 'no model configured'))).toEqual([]);
  });
});

describe('buildImagingNote', () => {
  it('says plainly that the image was not analysed when no model is configured', () => {
    const note = buildImagingNote(result([], 'No X-ray analysis model is configured.'));
    expect(note).toMatch(/not been checked/i);
    expect(note).toMatch(/only a doctor can tell you/i);
  });

  it('does not let "nothing flagged" read as "your X-ray is normal"', () => {
    const note = buildImagingNote(result([{ pathology: 'Effusion', probability: 0.05 }]));
    expect(note).toMatch(/not the same as your X-ray being normal/i);
    expect(note).toMatch(/fixed list of conditions/i);
  });

  it('lists what was flagged with the numbers behind it', () => {
    const note = buildImagingNote(
      result([
        { pathology: 'Pneumonia', probability: 0.81 },
        { pathology: 'Effusion', probability: 0.62 },
      ])
    );
    expect(note).toMatch(/pneumonia \(81%\)/i);
    expect(note).toMatch(/effusion \(62%\)/i);
    expect(note).toMatch(/not a diagnosis/i);
  });
});

describe('out-of-distribution guard', () => {
  // Real measurements: a true radiograph drives most pathologies near zero, while a
  // phone photo of a film on a lightbox collapses everything onto the decision
  // boundary. Reporting the second as findings would have told a patient they might
  // have a pneumothorax (0.501) and a fracture (0.502) from pure noise.
  const REAL_RADIOGRAPH: PathologyScore[] = (
    [
      ['Infiltration', 0.522], ['Fibrosis', 0.507], ['Nodule', 0.297], ['Mass', 0.29],
      ['Pleural Thickening', 0.23], ['Pneumothorax', 0.22], ['Emphysema', 0.16],
      ['Consolidation', 0.154], ['Atelectasis', 0.148], ['Lung Opacity', 0.064],
      ['Fracture', 0.063], ['Enlarged Cardiomediastinum', 0.042], ['Effusion', 0.03],
      ['Pneumonia', 0.016], ['Lung Lesion', 0.012], ['Hernia', 0.002],
      ['Cardiomegaly', 0.001], ['Edema', 0.001],
    ] as const
  ).map(([pathology, probability]) => ({ pathology, probability }) as PathologyScore);

  const PHOTO_OF_FILM: PathologyScore[] = (
    [
      ['Edema', 0.632], ['Lung Opacity', 0.596], ['Enlarged Cardiomediastinum', 0.537],
      ['Effusion', 0.528], ['Cardiomegaly', 0.527], ['Pneumonia', 0.514],
      ['Emphysema', 0.512], ['Consolidation', 0.504], ['Fracture', 0.502],
      ['Pneumothorax', 0.501], ['Atelectasis', 0.463], ['Infiltration', 0.291],
      ['Lung Lesion', 0.275], ['Mass', 0.218], ['Fibrosis', 0.204], ['Nodule', 0.078],
      ['Hernia', 0.054], ['Pleural Thickening', 0.009],
    ] as const
  ).map(([pathology, probability]) => ({ pathology, probability }) as PathologyScore);

  it('accepts a discriminating result from a real radiograph', () => {
    expect(isDiscriminating(REAL_RADIOGRAPH)).toBe(true);
  });

  it('rejects scores collapsed onto the decision boundary', () => {
    expect(isDiscriminating(PHOTO_OF_FILM)).toBe(false);
  });

  it('would otherwise have flagged a pneumothorax and a fracture from noise', () => {
    // What the reporting thresholds do to that input if the guard is bypassed.
    const flagged = selectFlagged(PHOTO_OF_FILM).map((s) => s.pathology);
    expect(flagged).toContain('Pneumothorax');
    expect(flagged).toContain('Fracture');
    expect(flagged.length).toBeGreaterThan(8);
  });

  it('does not judge a result with too few labels to have a shape', () => {
    expect(isDiscriminating([{ pathology: 'Effusion', probability: 0.5 }])).toBe(true);
  });
});
