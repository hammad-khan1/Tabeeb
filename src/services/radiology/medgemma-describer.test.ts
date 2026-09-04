import { describe, it, expect } from 'vitest';
import {
  buildDescriptionNote,
  __testContainsReassurance as containsReassurance,
  type RadiographDescription,
} from './medgemma-describer';

/**
 * The reassurance guard exists because of a real observed failure: asked to describe a
 * foot X-ray it could barely read, MedGemma wrote "the bones appear generally normal
 * in shape" despite an explicit instruction never to reassure. A patient acting on
 * that might not get a fracture looked at.
 */

function result(description: string, corrected = false): RadiographDescription {
  return { description, modelId: 'medgemma:4b', bodyRegion: 'lower limb', reassuranceCorrected: corrected };
}

describe('buildDescriptionNote', () => {
  it('returns nothing when there is no description', () => {
    expect(buildDescriptionNote(result(''))).toBeNull();
  });

  it('labels the description as a model reading, not a report', () => {
    const note = buildDescriptionNote(result('This is an X-ray of a foot.'))!;
    expect(note).toMatch(/read by an AI model/i);
    expect(note).toMatch(/not a diagnosis/i);
    expect(note).toMatch(/cannot rule anything out/i);
  });

  it('contradicts reassurance rather than letting it stand', () => {
    const note = buildDescriptionNote(
      result('The bones appear generally normal in shape.', true)
    )!;
    expect(note).toMatch(/disregard that/i);
    expect(note).toMatch(/cannot rule out a fracture/i);
  });

  it('does not add the correction when nothing reassuring was said', () => {
    const note = buildDescriptionNote(result('This is an X-ray of a foot.', false))!;
    expect(note).not.toMatch(/disregard/i);
  });
});

describe('reassurance detection', () => {
  // Both of these are verbatim from MedGemma runs on the user's own X-rays.
  it.each([
    'The bones appear generally normal in shape.',
    'There does not appear to be any obvious fractures or dislocations.',
    'The bones look normal.',
    'There is no obvious fracture.',
    'No apparent abnormalities are seen.',
    'The structures appear intact.',
    'Within normal limits.',
    'I cannot see any breaks in the bone.',
    'Alignment is preserved.',
  ])('flags reassurance: %s', (text) => {
    expect(containsReassurance(text)).toBe(true);
  });

  it.each([
    'This is an X-ray of a foot showing the metatarsals and phalanges.',
    'There appears to be a metallic object in the area of the fibula.',
    'The image quality is limited due to glare on the film.',
    'This is an image of both feet, side by side.',
    'It is difficult to assess for subtle abnormalities.',
  ])('does not flag a plain observation: %s', (text) => {
    // Over-flagging would bury every description under a contradiction notice.
    expect(containsReassurance(text)).toBe(false);
  });
});
