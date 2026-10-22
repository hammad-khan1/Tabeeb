import { describe, it, expect } from 'vitest';
import { evaluateReading, toMgDl, alertMessage } from './glucose-rules';

const none = [] as const;

describe('toMgDl', () => {
  it('converts mmol/L at 18.016', () => {
    expect(toMgDl(5, 'mmol_l')).toBeCloseTo(90.08, 5);
    expect(toMgDl(120, 'mg_dl')).toBe(120);
  });

  it('rejects values that are not readings', () => {
    expect(() => toMgDl(-1, 'mg_dl')).toThrow(RangeError);
    expect(() => toMgDl(Number.NaN, 'mmol_l')).toThrow(RangeError);
  });
});

describe('evaluateReading', () => {
  it('alerts below 70 mg/dL, not at it', () => {
    expect(evaluateReading({ valueMgDl: 69, symptoms: none })).toBe('low');
    expect(evaluateReading({ valueMgDl: 70, symptoms: none })).toBe('none');
  });

  it('alerts above 300 mg/dL, not at it', () => {
    expect(evaluateReading({ valueMgDl: 300, symptoms: none })).toBe('none');
    expect(evaluateReading({ valueMgDl: 301, symptoms: none })).toBe('high');
  });

  it('applies the same edges to mmol/L readings', () => {
    expect(evaluateReading({ valueMgDl: toMgDl(3.8, 'mmol_l'), symptoms: none })).toBe('low');
    expect(evaluateReading({ valueMgDl: toMgDl(3.9, 'mmol_l'), symptoms: none })).toBe('none');
    expect(evaluateReading({ valueMgDl: toMgDl(16.6, 'mmol_l'), symptoms: none })).toBe('none');
    expect(evaluateReading({ valueMgDl: toMgDl(16.7, 'mmol_l'), symptoms: none })).toBe('high');
  });

  it('alerts on symptoms whatever the reading', () => {
    expect(evaluateReading({ valueMgDl: 120, symptoms: ['shaking'] })).toBe('symptom');
    expect(evaluateReading({ valueMgDl: null, symptoms: ['confusion'] })).toBe('symptom');
  });

  it('reports a low reading as low even with symptoms, so the advice is specific', () => {
    expect(evaluateReading({ valueMgDl: 55, symptoms: ['sweating'] })).toBe('low');
  });

  it('does not alert with nothing to go on', () => {
    expect(evaluateReading({ valueMgDl: null, symptoms: none })).toBe('none');
  });
});

describe('alertMessage', () => {
  it('tells the patient to break the fast, in Urdu first', () => {
    const message = alertMessage('low');
    expect(message?.action.ur).toContain('روزہ فوراً کھول دیں');
    expect(message?.action.roman).toBe('Roza foran khol dein aur meetha lein.');
    expect(message?.notifyCaregiver).toBe(true);
  });

  it('adds the permitted line to every alert', () => {
    for (const level of ['low', 'high', 'symptom'] as const) {
      expect(alertMessage(level)?.permitted.roman).toBe('Sehat ki khatir roza todna jaiz hai.');
    }
  });

  it('notifies the caregiver for low and high readings, not symptoms alone', () => {
    expect(alertMessage('high')?.notifyCaregiver).toBe(true);
    expect(alertMessage('symptom')?.notifyCaregiver).toBe(false);
  });

  it('has nothing to say when there is no alert', () => {
    expect(alertMessage('none')).toBeNull();
  });
});
