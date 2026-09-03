import type { RadiologyFinding } from '../text-extractors/image-extractor';

interface ValidatedFinding extends RadiologyFinding {
  urgencyLevel: 'routine' | 'follow-up' | 'urgent' | 'critical';
  validationNotes: string;
  validated: boolean;
}

const URGENT_FINDINGS = new Set([
  'pneumothorax', 'tension pneumothorax', 'hemorrhage', 'massive effusion',
  'acute fracture with displacement', 'free air', 'bowel perforation',
  'aortic dissection', 'pulmonary embolism', 'cardiac tamponade',
  'intracranial hemorrhage', 'midline shift', 'herniation',
]);

const FOLLOW_UP_FINDINGS = new Set([
  'nodule', 'mass', 'opacity', 'infiltrate', 'consolidation',
  'effusion', 'lymphadenopathy', 'bone lesion', 'suspicious calcification',
]);

const BODY_PART_VALIDITY: Record<string, string[]> = {
  chest: ['rib', 'clavicle', 'scapula', 'sternum', 'vertebra', 'lung', 'heart', 'mediastinum', 'pleura', 'diaphragm', 'hila'],
  abdomen: ['liver', 'spleen', 'kidney', 'bowel', 'stomach', 'pancreas', 'gallbladder', 'spine', 'pelvis'],
  spine: ['vertebra', 'disc', 'spinal canal', 'foramen', 'facet joint', 'pedicle', 'lamina'],
  extremity: ['femur', 'tibia', 'fibula', 'humerus', 'radius', 'ulna', 'joint', 'metacarpal', 'metatarsal', 'phalanx'],
  skull: ['calvarium', 'sinus', 'orbit', 'mandible', 'mastoid', 'temporal bone'],
  pelvis: ['hip', 'acetabulum', 'sacrum', 'coccyx', 'pubic bone', 'ischium', 'ilium'],
};

function determineUrgency(finding: RadiologyFinding): ValidatedFinding['urgencyLevel'] {
  const findingLower = (finding.finding ?? '').toLowerCase();
  const severityLower = (finding.severity ?? '').toLowerCase();

  for (const urgent of URGENT_FINDINGS) {
    if (findingLower.includes(urgent)) return 'critical';
  }

  if (severityLower === 'critical') return 'critical';
  if (severityLower === 'severe') return 'urgent';

  for (const followUp of FOLLOW_UP_FINDINGS) {
    if (findingLower.includes(followUp)) return 'follow-up';
  }

  return 'routine';
}

function validateAnatomicalPlausibility(finding: RadiologyFinding): string {
  const bodyPart = (finding.bodyPart ?? '').toLowerCase();
  const location = (finding.location || '').toLowerCase();
  const validParts = BODY_PART_VALIDITY[bodyPart];

  if (!validParts) return `Body part "${finding.bodyPart}" not in standard classification — review recommended.`;

  const isPlausible = validParts.some((part) => location.includes(part));
  if (isPlausible) return `Anatomically consistent with ${finding.bodyPart} imaging.`;

  return `Location "${finding.location}" may not be typical for ${finding.bodyPart} — verify anatomical correlation.`;
}

export function validateFindings(findings: RadiologyFinding[]): ValidatedFinding[] {
  return findings.map((finding) => {
    const urgencyLevel = determineUrgency(finding);
    const anatomicalNote = validateAnatomicalPlausibility(finding);

    const notes: string[] = [anatomicalNote];

    if (urgencyLevel === 'critical') {
      notes.push('URGENT: This finding requires immediate clinical attention.');
    } else if (urgencyLevel === 'urgent') {
      notes.push('This finding warrants prompt clinical follow-up.');
    }

    notes.push('AI-assisted analysis only. Professional radiological review required.');

    return {
      ...finding,
      urgencyLevel,
      validationNotes: notes.join(' '),
      validated: true,
    };
  });
}
