import type { ClassificationResult, Pathology, PathologyScore } from './classifier';

/**
 * Turns classifier output into the findings stored on a document.
 *
 * Every field here is derived from the model's probabilities and a fixed clinical
 * table. Nothing is generated. The previous version accepted findings invented by a
 * general-purpose vision LLM and stamped `validated: true` on them, which asserted a
 * verification that had never happened.
 */

export interface ValidatedFinding {
  finding: string;
  bodyPart: string;
  location: string | null;
  severity: string;
  description: string;
  /** The model's probability as a percentage. */
  confidence: number;
  urgencyLevel: 'routine' | 'follow-up' | 'urgent' | 'critical';
  validationNotes: string;
  /** Always false: no clinician has reviewed this. */
  validated: boolean;
}

/**
 * How each pathology should be escalated, and how to describe it to a patient who is
 * not a clinician. Urgency reflects what the finding would mean if confirmed — it is
 * not a claim that this patient has it.
 */
const PATHOLOGY_INFO: Record<
  Pathology,
  { urgency: ValidatedFinding['urgencyLevel']; plain: string }
> = {
  Pneumothorax: {
    urgency: 'critical',
    plain: 'a possible collapsed lung, where air has leaked into the space around the lung',
  },
  Mass: {
    urgency: 'urgent',
    plain: 'a possible mass — an area of tissue that should be looked at properly',
  },
  Nodule: {
    urgency: 'follow-up',
    plain: 'a possible small round spot in the lung, which usually needs a repeat scan to watch',
  },
  Fracture: { urgency: 'urgent', plain: 'a possible broken bone' },
  Edema: { urgency: 'urgent', plain: 'possible fluid building up in the lungs' },
  Effusion: { urgency: 'follow-up', plain: 'possible fluid collecting around the lung' },
  Consolidation: {
    urgency: 'follow-up',
    plain: 'an area of lung that looks solid rather than air-filled, often seen with infection',
  },
  Pneumonia: { urgency: 'urgent', plain: 'possible signs of a chest infection' },
  Infiltration: {
    urgency: 'follow-up',
    plain: 'hazy areas in the lung that can be seen with infection or inflammation',
  },
  'Lung Opacity': { urgency: 'follow-up', plain: 'an area of the lung that looks denser than usual' },
  'Lung Lesion': { urgency: 'follow-up', plain: 'an area of abnormal-looking lung tissue' },
  Atelectasis: { urgency: 'follow-up', plain: 'a part of the lung that may not be fully inflated' },
  Cardiomegaly: { urgency: 'follow-up', plain: 'the heart may look larger than usual on this film' },
  'Enlarged Cardiomediastinum': {
    urgency: 'follow-up',
    plain: 'the area around the heart may look wider than usual',
  },
  Emphysema: { urgency: 'routine', plain: 'possible signs of long-term lung damage' },
  Fibrosis: { urgency: 'routine', plain: 'possible scarring in the lung tissue' },
  'Pleural Thickening': {
    urgency: 'routine',
    plain: 'the lining around the lung may look thickened',
  },
  Hernia: { urgency: 'routine', plain: 'a possible hernia near the diaphragm' },
};

/** Probability bands, used only to word the finding — not a clinical grade. */
function describeConfidence(probability: number): string {
  if (probability >= 0.85) return 'strong';
  if (probability >= 0.65) return 'moderate';
  return 'weak';
}

function severityFor(urgency: ValidatedFinding['urgencyLevel']): string {
  switch (urgency) {
    case 'critical':
      return 'critical';
    case 'urgent':
      return 'severe';
    case 'follow-up':
      return 'moderate';
    default:
      return 'mild';
  }
}

const DISCLAIMER =
  'This is an automated screening flag from an AI model, not a diagnosis and not a radiologist’s reading. It must be confirmed by a doctor.';

function toFinding(score: PathologyScore, modelId: string): ValidatedFinding {
  const info = PATHOLOGY_INFO[score.pathology];
  const percent = Math.round(score.probability * 100);
  const strength = describeConfidence(score.probability);

  const notes = [
    `Automated screening by ${modelId} gave a ${strength} signal (${percent}%) for ${score.pathology.toLowerCase()}.`,
  ];
  if (info.urgency === 'critical') {
    notes.push('If confirmed this would need immediate attention — do not wait to have it checked.');
  } else if (info.urgency === 'urgent') {
    notes.push('This warrants prompt review by a doctor.');
  }
  notes.push(DISCLAIMER);

  return {
    finding: score.pathology,
    bodyPart: 'chest',
    location: null,
    severity: severityFor(info.urgency),
    description: `The screening model flagged ${info.plain} (${percent}% signal).`,
    confidence: percent,
    urgencyLevel: info.urgency,
    validationNotes: notes.join(' '),
    // No clinician has reviewed this. The old code set this true unconditionally.
    validated: false,
  };
}

export function buildFindings(result: ClassificationResult): ValidatedFinding[] {
  return result.flagged.map((score) => toFinding(score, result.modelId));
}

/**
 * The note shown on an imaging document, covering both the "nothing flagged" and
 * "not analysed" cases explicitly — silence must never read as "your X-ray is clear".
 */
export function buildImagingNote(result: ClassificationResult): string {
  if (result.unavailableReason) {
    return `${result.unavailableReason} This X-ray has not been checked for any abnormality — only a doctor can tell you what it shows.`;
  }

  if (result.flagged.length === 0) {
    const top = result.scores[0];
    return (
      'The automated screening model did not flag any of the conditions it can detect' +
      (top ? ` (highest signal: ${top.pathology.toLowerCase()}, ${Math.round(top.probability * 100)}%)` : '') +
      '. That is not the same as your X-ray being normal — the model only looks for a fixed list of conditions on adult chest films, and it is not a radiologist. ' +
      DISCLAIMER
    );
  }

  const list = result.flagged
    .map((s) => `${s.pathology.toLowerCase()} (${Math.round(s.probability * 100)}%)`)
    .join(', ');

  // Many scores bunched near the operating point. That happens both when the model is
  // unsure and when a chest genuinely shows widespread changes, so it is reported as a
  // caveat rather than used to hide the result.
  const spread = result.lowConfidenceSpread
    ? ' Several of these sit close together near the model’s decision threshold, so treat the ordering as weak.'
    : '';

  return `The automated screening model flagged: ${list}.${spread} ${DISCLAIMER}`;
}
