import { describe, it, expect } from 'vitest';
import {
  ANTENATAL_DANGER_SIGNS,
  AUDIO_RECORDED,
  POSTNATAL_DANGER_SIGNS,
  caregiverAlertText,
  findSign,
  GO_TO_HOSPITAL,
} from './danger-signs';
import * as dangerSigns from './danger-signs';

describe('danger signs', () => {
  it('lists the eight signs in pregnancy from the specification', () => {
    expect(ANTENATAL_DANGER_SIGNS.map((sign) => sign.id)).toEqual([
      'bleeding',
      'headache_vision_swelling',
      'fits',
      'high_fever',
      'abdominal_pain',
      'breathing',
      'reduced_movement',
      'waters_breaking',
    ]);
  });

  it('covers heavy bleeding and the pre-eclampsia signs before and after birth', () => {
    expect(findSign('antenatal', 'bleeding')).not.toBeNull();
    expect(findSign('antenatal', 'headache_vision_swelling')).not.toBeNull();
    expect(findSign('postnatal', 'heavy_bleeding')).not.toBeNull();
    expect(findSign('postnatal', 'headache_vision_swelling')).not.toBeNull();
  });

  it('has text in Urdu, Roman Urdu and English for every sign', () => {
    for (const sign of [...ANTENATAL_DANGER_SIGNS, ...POSTNATAL_DANGER_SIGNS]) {
      expect(sign.text.ur, sign.id).toMatch(/[؀-ۿ]/);
      expect(sign.text.roman, sign.id).toMatch(/^[\x20-\x7e]+$/);
      expect(sign.text.en, sign.id).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it('has unique ids within each phase', () => {
    for (const signs of [ANTENATAL_DANGER_SIGNS, POSTNATAL_DANGER_SIGNS]) {
      const ids = signs.map((sign) => sign.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('gives every sign the same instruction, with no grading', () => {
    expect(GO_TO_HOSPITAL.roman).toBe('Foran hospital jayein');
    // Nothing on a sign may suggest waiting or a lesser level of urgency.
    for (const sign of [...ANTENATAL_DANGER_SIGNS, ...POSTNATAL_DANGER_SIGNS]) {
      expect(Object.keys(sign).sort()).toEqual(['audio', 'icon', 'id', 'text']);
    }
    expect(Object.keys(dangerSigns)).not.toContain('SEVERITY');
  });

  it('plays no audio until it has been recorded', () => {
    expect(AUDIO_RECORDED.size).toBe(0);
  });

  it('names the mother in the family alert, without naming a condition', () => {
    const text = caregiverAlertText('Ayesha', findSign('antenatal', 'bleeding')!.text);
    expect(text.roman).toBe(
      'Ayesha ko khatre ki alamat hai: Sharamgah se khoon aana, kisi bhi waqt. Unhein foran hospital le jayein.'
    );
    expect(text.en).not.toMatch(/eclampsia|haemorrhage|hemorrhage/i);
  });
});
