import { describe, it, expect } from 'vitest';
import { cleanMarkdownForSpeech, chunkTextForSpeech } from './cleaner';

describe('cleanMarkdownForSpeech', () => {
  it('strips markdown headings and ensures natural pause punctuation', () => {
    const input = '# Medication Overview\nYou have 2 active prescriptions.';
    const output = cleanMarkdownForSpeech(input, { lang: 'en' });
    expect(output).toContain('Medication Overview.');
    expect(output).not.toContain('#');
  });

  it('strips citations like [Source 1] and [Source 1, Source 2]', () => {
    const input = 'Take Panadol 500 mg [Source 1] twice daily [Source 1, Source 2].';
    const output = cleanMarkdownForSpeech(input, { lang: 'en' });
    expect(output).toBe('Take Panadol 500 milligrams twice daily.');
    expect(output).not.toContain('Source 1');
  });

  it('preserves link text but removes raw URLs and citation links', () => {
    const input = 'Refer to [Blood Test Report](https://example.com/doc/123) and [Source 2](#citation-2).';
    const output = cleanMarkdownForSpeech(input, { lang: 'en' });
    expect(output).toContain('Refer to Blood Test Report');
    expect(output).not.toContain('https://');
    expect(output).not.toContain('#citation-2');
  });

  it('converts bullet points into sequential paused clauses', () => {
    const input = `
- Take 1 tablet daily with food
- Avoid drinking alcohol
- Report any rash immediately
    `.trim();
    const output = cleanMarkdownForSpeech(input, { lang: 'en' });
    expect(output).toContain('Take 1 tablet daily with food.');
    expect(output).toContain('Avoid drinking alcohol.');
    expect(output).toContain('Report any rash immediately.');
    expect(output).not.toContain('-');
  });

  it('converts markdown table rows into readable lines', () => {
    const input = `
| Medicine | Dose | Frequency |
|---|---|---|
| Panadol | 500 mg | twice daily |
| Augmentin | 625 mg | every 12 hours |
    `.trim();
    const output = cleanMarkdownForSpeech(input, { lang: 'en' });
    expect(output).toContain('Medicine, Dose, Frequency.');
    expect(output).toContain('Panadol, 500 milligrams, twice daily.');
    expect(output).toContain('Augmentin, 625 milligrams, every 12 hours.');
    expect(output).not.toContain('|');
  });

  it('safely expands English medical abbreviations and units without mutating clinical values', () => {
    const input = 'Prescribed Amoxicillin 250 mg po bid for 5 days. Liquid form 5 ml prn.';
    const output = cleanMarkdownForSpeech(input, { lang: 'en' });
    expect(output).toContain('250 milligrams');
    expect(output).toContain('by mouth');
    expect(output).toContain('twice daily');
    expect(output).toContain('5 milliliters');
    expect(output).toContain('as needed');
  });

  it('preserves clinical values and does not expand units when disabled or in Urdu', () => {
    const input = 'پیناڈول 500 mg روزانہ دو بار لیں۔';
    const output = cleanMarkdownForSpeech(input, { lang: 'ur', expandUnits: false });
    expect(output).toContain('500 mg');
  });
});

describe('chunkTextForSpeech', () => {
  it('returns a single chunk for short text', () => {
    const text = 'Take your medicine twice daily after lunch.';
    const chunks = chunkTextForSpeech(text, 100);
    expect(chunks).toEqual([text]);
  });

  it('splits long medical text by sentence boundaries without losing words', () => {
    const text =
      'First, your prescription specifies Panadol 500 mg twice daily. Second, continue taking your blood pressure medication every morning. Third, be sure to drink plenty of fluids throughout the day.';
    const chunks = chunkTextForSpeech(text, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(' ')).toBe(text);
  });

  it('handles Urdu sentence delimiters correctly', () => {
    const urdu = 'پہلی خوراک صبح لیں۔ دوسری خوراک رات کو سونے سے پہلے لیں۔';
    const chunks = chunkTextForSpeech(urdu, 40);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe('پہلی خوراک صبح لیں۔');
    expect(chunks[1]).toBe('دوسری خوراک رات کو سونے سے پہلے لیں۔');
  });
});
