/**
 * Danger signs in pregnancy and after birth. Fixed text, never generated.
 *
 * Every sign has the same instruction — go to the hospital now — and nothing here
 * grades a sign as mild or says to wait. The app never names a condition: it says the
 * sign can be dangerous, not what the patient has.
 *
 * Sources: WHO, Pregnancy, childbirth, postpartum and newborn care (IMPAC, 3rd ed.,
 * 2015), danger signs for the woman in pregnancy and after birth; the Mother-care
 * specification. Heavy bleeding and hypertensive disorders together caused 70% of
 * maternal deaths in the Pakistan Maternal Mortality Survey 2019 (41% and 29%).
 *
 * The Urdu was written for this app and must be reviewed by a doctor before release.
 */

import type { AlertText } from '../notify';

export type DangerPhase = 'antenatal' | 'postnatal';

export interface DangerSign {
  id: string;
  /** A lucide icon name, so the screen shows a picture beside the words. */
  icon: 'droplets' | 'eye' | 'zap' | 'thermometer' | 'flame' | 'wind' | 'baby' | 'waves' | 'footprints' | 'bed';
  text: AlertText;
  /** Recorded Urdu audio, served from public/. Only played once it exists — see AUDIO_RECORDED. */
  audio: string;
}

const PRE_ECLAMPSIA_SIGNS: AlertText = {
  ur: 'شدید سر درد، دھندلا نظر آنا، یا چہرے اور ہاتھوں پر سوجن',
  roman: 'Shadeed sar dard, dhundla nazar aana, ya chehre aur hathon par sojan',
  en: 'Severe headache, blurred vision, or swelling of the face and hands',
};

const FITS: AlertText = {
  ur: 'دورے پڑنا یا جھٹکے لگنا',
  roman: 'Daure parna ya jhatke lagna',
  en: 'Fits or convulsions',
};

const SEVERE_ABDOMINAL_PAIN: AlertText = {
  ur: 'پیٹ میں شدید درد',
  roman: 'Pait mein shadeed dard',
  en: 'Severe pain in the stomach',
};

function sign(id: string, icon: DangerSign['icon'], text: AlertText, phase: DangerPhase): DangerSign {
  return { id, icon, text, audio: `/audio/pregnancy/${phase}-${id}.mp3` };
}

export const ANTENATAL_DANGER_SIGNS: readonly DangerSign[] = [
  sign('bleeding', 'droplets', {
    ur: 'شرمگاہ سے خون آنا، کسی بھی وقت',
    roman: 'Sharamgah se khoon aana, kisi bhi waqt',
    en: 'Bleeding from the vagina, at any stage',
  }, 'antenatal'),
  sign('headache_vision_swelling', 'eye', PRE_ECLAMPSIA_SIGNS, 'antenatal'),
  sign('fits', 'zap', FITS, 'antenatal'),
  sign('high_fever', 'thermometer', { ur: 'تیز بخار', roman: 'Tez bukhar', en: 'High fever' }, 'antenatal'),
  sign('abdominal_pain', 'flame', SEVERE_ABDOMINAL_PAIN, 'antenatal'),
  sign('breathing', 'wind', {
    ur: 'سانس لینے میں دشواری',
    roman: 'Saans lene mein dushwari',
    en: 'Difficulty breathing',
  }, 'antenatal'),
  sign('reduced_movement', 'baby', {
    ur: 'بچے کا معمول سے بہت کم حرکت کرنا',
    roman: 'Bachay ka mamool se bohat kam harkat karna',
    en: 'Baby moving much less than usual',
  }, 'antenatal'),
  sign('waters_breaking', 'waves', {
    ur: 'دردِ زہ شروع ہونے سے پہلے پانی آ جانا',
    roman: 'Dard-e-zeh shuru hone se pehle pani aa jana',
    en: 'Water breaking before labour pains start',
  }, 'antenatal'),
];

export const POSTNATAL_DANGER_SIGNS: readonly DangerSign[] = [
  sign('heavy_bleeding', 'droplets', {
    ur: 'ڈیلیوری کے بعد بہت زیادہ خون آنا',
    roman: 'Delivery ke baad bohat zyada khoon aana',
    en: 'Heavy bleeding after the birth',
  }, 'postnatal'),
  sign('headache_vision_swelling', 'eye', PRE_ECLAMPSIA_SIGNS, 'postnatal'),
  sign('fits', 'zap', FITS, 'postnatal'),
  sign('fever_weakness', 'bed', {
    ur: 'بخار، یا اتنی کمزوری کہ بستر سے نہ اٹھ سکیں',
    roman: 'Bukhar, ya itni kamzori ke bistar se na uth sakein',
    en: 'Fever, or too weak to get out of bed',
  }, 'postnatal'),
  sign('breathing', 'wind', {
    ur: 'تیز یا مشکل سانس، یا سینے میں درد',
    roman: 'Tez ya mushkil saans, ya seene mein dard',
    en: 'Fast or difficult breathing, or chest pain',
  }, 'postnatal'),
  sign('abdominal_pain', 'flame', SEVERE_ABDOMINAL_PAIN, 'postnatal'),
  sign('calf_pain', 'footprints', {
    ur: 'پنڈلی میں درد، سرخی یا سوجن',
    roman: 'Pindli mein dard, surkhi ya sojan',
    en: 'Pain, redness or swelling in the calf',
  }, 'postnatal'),
  sign('foul_discharge', 'waves', {
    ur: 'شرمگاہ سے بدبودار پانی آنا',
    roman: 'Sharamgah se badbudar pani aana',
    en: 'Foul-smelling discharge from the vagina',
  }, 'postnatal'),
];

/** The one instruction for every sign. */
export const GO_TO_HOSPITAL: AlertText = {
  ur: 'فوراً ہسپتال جائیں',
  roman: 'Foran hospital jayein',
  en: 'Go to the hospital now',
};

export const SIGN_CAN_BE_DANGEROUS: AlertText = {
  ur: 'یہ علامت خطرناک ہو سکتی ہے۔ انتظار نہ کریں۔',
  roman: 'Yeh alamat khatarnaak ho sakti hai. Intezar na karein.',
  en: 'This sign can be dangerous. Do not wait.',
};

/**
 * Audio clips recorded with a real voice and reviewed by a doctor. None is yet, so the
 * play button is hidden; add a sign's id here once public<audio> exists for it. Never
 * replaced by a live synthetic voice: a mispronounced danger sign is worse than none.
 */
export const AUDIO_RECORDED: ReadonlySet<string> = new Set<string>();

export function signsFor(phase: DangerPhase): readonly DangerSign[] {
  return phase === 'postnatal' ? POSTNATAL_DANGER_SIGNS : ANTENATAL_DANGER_SIGNS;
}

export function findSign(phase: DangerPhase, id: string): DangerSign | null {
  return signsFor(phase).find((candidate) => candidate.id === id) ?? null;
}

/** What a family member's phone receives when she taps a sign. */
export function caregiverAlertText(motherName: string, signText: AlertText): AlertText {
  return {
    ur: `${motherName} کو خطرے کی علامت ہے: ${signText.ur}۔ انہیں فوراً ہسپتال لے جائیں۔`,
    roman: `${motherName} ko khatre ki alamat hai: ${signText.roman}. Unhein foran hospital le jayein.`,
    en: `${motherName} has a danger sign: ${signText.en}. Take her to the hospital now.`,
  };
}
