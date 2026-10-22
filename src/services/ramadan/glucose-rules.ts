/**
 * Break-the-fast rules: a logged reading, or symptoms, to an alert level. Pure and
 * deterministic — the thresholds are in constants.ts with their source.
 */

import {
  BREAK_FAST_ABOVE_MG_DL,
  BREAK_FAST_BELOW_MG_DL,
  MG_DL_PER_MMOL_L,
} from './constants';

export type GlucoseUnit = 'mg_dl' | 'mmol_l';

export type AlertLevel = 'none' | 'low' | 'high' | 'symptom';

/**
 * Symptoms that mean "break the fast whatever the reading": those of hypoglycaemia,
 * and acute illness.
 */
export const SYMPTOMS = ['shaking', 'sweating', 'confusion', 'fainting', 'acute_illness'] as const;
export type Symptom = (typeof SYMPTOMS)[number];

/** Readings are stored in mg/dL; mmol/L is accepted and converted on the way in. */
export function toMgDl(value: number, unit: GlucoseUnit): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Not a glucose reading: ${value}`);
  }
  return unit === 'mmol_l' ? value * MG_DL_PER_MMOL_L : value;
}

export interface Reading {
  /** null when the entry is symptoms alone. */
  valueMgDl: number | null;
  symptoms: readonly Symptom[];
}

/**
 * A low or high reading outranks symptoms, because it says which way the patient is
 * going and the advice differs: something sweet for a low, a doctor for a high.
 */
export function evaluateReading({ valueMgDl, symptoms }: Reading): AlertLevel {
  if (valueMgDl !== null) {
    if (!Number.isFinite(valueMgDl) || valueMgDl < 0) {
      throw new RangeError(`Not a glucose reading: ${valueMgDl}`);
    }
    if (valueMgDl < BREAK_FAST_BELOW_MG_DL) return 'low';
    if (valueMgDl > BREAK_FAST_ABOVE_MG_DL) return 'high';
  }
  return symptoms.length > 0 ? 'symptom' : 'none';
}

export interface AlertText {
  ur: string;
  roman: string;
  en: string;
}

export interface AlertMessage {
  action: AlertText;
  /** Shown with every alert: patients often keep fasting against advice. */
  permitted: AlertText;
  notifyCaregiver: boolean;
}

/**
 * Alert wording. A doctor should review the Urdu before a real patient sees it.
 * "Permitted" is the build spec's line, stated as the patient's allowance rather than
 * a ruling on whether they should have fasted.
 */
const PERMITTED: AlertText = {
  ur: 'صحت کی خاطر روزہ توڑنا جائز ہے۔',
  roman: 'Sehat ki khatir roza todna jaiz hai.',
  en: 'Breaking the fast for your health is permitted.',
};

const ACTIONS: Record<Exclude<AlertLevel, 'none'>, { action: AlertText; notifyCaregiver: boolean }> = {
  low: {
    action: {
      ur: 'روزہ فوراً کھول دیں اور میٹھا لیں۔',
      roman: 'Roza foran khol dein aur meetha lein.',
      en: 'Break your fast now and take something sweet.',
    },
    notifyCaregiver: true,
  },
  high: {
    action: {
      ur: 'روزہ فوراً کھول دیں اور ڈاکٹر سے رابطہ کریں۔',
      roman: 'Roza foran khol dein aur doctor se rabta karein.',
      en: 'Break your fast now and contact your doctor.',
    },
    notifyCaregiver: true,
  },
  symptom: {
    action: {
      ur: 'روزہ فوراً کھول دیں۔ ہو سکے تو شوگر چیک کریں۔',
      roman: 'Roza foran khol dein. Ho sake to sugar check karein.',
      en: 'Break your fast now. If you can, check your sugar.',
    },
    notifyCaregiver: false,
  },
};

export function alertMessage(level: AlertLevel): AlertMessage | null {
  if (level === 'none') return null;
  return { ...ACTIONS[level], permitted: PERMITTED };
}
