import { describe, it, expect } from 'vitest';
import { buildFindings, buildImagingNote } from './validator';
import { selectFlagged, type ClassificationResult, type PathologyScore } from './classifier';

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
