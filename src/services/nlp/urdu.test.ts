import { describe, it, expect } from 'vitest';
import {
  detectScript,
  normalizeUrdu,
  normalizeEasternDigits,
  romanKey,
  lookupMedicalTerm,
  findMedicalTerms,
  toEnglishTerms,
} from './urdu';

describe('detectScript', () => {
  it('recognises Urdu, Latin and mixed text', () => {
    expect(detectScript('مجھے شوگر ہے')).toBe('urdu');
    expect(detectScript('mujhe shugar hai')).toBe('latin');
    expect(detectScript('Patient has شوگر and بلڈ پریشر')).toBe('mixed');
  });

  it('reports unknown for text with no letters', () => {
    expect(detectScript('123 - 456')).toBe('unknown');
  });
});

describe('normalizeUrdu', () => {
  it('folds Arabic keyboard letters onto their Urdu equivalents', () => {
    // Same word typed on an Arabic keyboard (yeh, kaf) and an Urdu one.
    expect(normalizeUrdu('ديابيطس')).toBe(normalizeUrdu('دیابیطس'));
  });

  it('strips diacritics so an optional harakat does not break a match', () => {
    expect(normalizeUrdu('بُخار')).toBe('بخار');
  });

  it('converts eastern digits and collapses whitespace', () => {
    expect(normalizeUrdu('شوگر  ۱۲۰')).toBe('شوگر 120');
    expect(normalizeEasternDigits('HbA1c ٦.٨')).toBe('HbA1c 6.8');
  });
});

describe('romanKey', () => {
  it('collapses spelling variants of the same word', () => {
    expect(romanKey('khansi')).toBe(romanKey('khaansi'));
    expect(romanKey('bukhar')).toBe(romanKey('bukhaar'));
    expect(romanKey('kamzori')).toBe(romanKey('kamzoree'));
  });

  it('keeps different words apart', () => {
    expect(romanKey('dard')).not.toBe(romanKey('dawa'));
  });

  it('returns an empty key for text with no letters', () => {
    expect(romanKey('123')).toBe('');
  });
});

describe('lookupMedicalTerm', () => {
  it('maps the Urdu word patients actually use for diabetes', () => {
    expect(lookupMedicalTerm('شوگر')?.english).toBe('diabetes');
  });

  it('maps Roman-Urdu spellings, including multi-word phrases', () => {
    expect(lookupMedicalTerm('bukhaar')?.english).toBe('fever');
    expect(lookupMedicalTerm('khoon ki kami')?.english).toBe('anemia');
  });

  it('returns null for words outside the lexicon rather than guessing', () => {
    expect(lookupMedicalTerm('metformin')).toBeNull();
    expect(lookupMedicalTerm('')).toBeNull();
  });
});

describe('findMedicalTerms', () => {
  it('prefers the longest phrase at a position', () => {
    const matches = findMedicalTerms('مریض کو خون کی کمی ہے');
    expect(matches.map((m) => m.english)).toContain('anemia');
    // "خون" alone must not also be reported once the phrase has consumed it.
    expect(matches.filter((m) => m.english === 'blood')).toHaveLength(0);
  });

  it('reads mixed-script sentences', () => {
    const english = findMedicalTerms('Patient has شوگر and بخار').map((m) => m.english);
    expect(english).toEqual(expect.arrayContaining(['diabetes', 'fever']));
  });
});

describe('toEnglishTerms', () => {
  it('returns the English equivalents of local words', () => {
    expect(toEnglishTerms('مجھے شوگر اور بخار ہے')).toEqual(
      expect.arrayContaining(['diabetes', 'fever'])
    );
  });

  it('adds nothing for text that is already English', () => {
    expect(toEnglishTerms('metformin 500mg twice daily')).toEqual([]);
  });

  it('does not repeat a term that appears twice', () => {
    expect(toEnglishTerms('شوگر شوگر')).toEqual(['diabetes']);
  });
});
