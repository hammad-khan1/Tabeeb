import { describe, it, expect } from 'vitest';
import { parseNumberWords, lookupNumberWord } from './number-words';

function read(text: string): number | null {
  return parseNumberWords(text.split(/\s+/))?.value ?? null;
}

describe('parseNumberWords', () => {
  it('reads Roman-Urdu numbers below a hundred', () => {
    expect(read('baasath')).toBe(62);
    expect(read('pachaas')).toBe(50);
    expect(read('sattar')).toBe(70);
    expect(read('nabbe')).toBe(90);
    expect(read('ninyaanave')).toBe(99);
  });

  it('reads Urdu-script numbers below a hundred', () => {
    expect(read('باسٹھ')).toBe(62);
    expect(read('ستر')).toBe(70);
    expect(read('آٹھ')).toBe(8);
  });

  it('composes hundreds', () => {
    expect(read('sau')).toBe(100);
    expect(read('ek sau')).toBe(100);
    expect(read('do sau bees')).toBe(220);
    expect(read('teen sau ek')).toBe(301);
    expect(read('paanch sau')).toBe(500);
    expect(read('دو سو بیس')).toBe(220);
  });

  it('reads the fractional hundreds people say', () => {
    expect(read('dedh sau')).toBe(150);
    expect(read('dhaai sau')).toBe(250);
    expect(read('sawa do sau')).toBe(225);
    expect(read('sarhe teen sau')).toBe(350);
    expect(read('paune do sau')).toBe(175);
    expect(read('ڈیڑھ سو')).toBe(150);
  });

  it('stops at 500', () => {
    expect(read('chhe sau')).toBeNull();
    expect(read('paanch sau ek')).toBeNull();
  });

  it('refuses word runs that are not one number', () => {
    expect(read('baasath sattar')).toBeNull();
    expect(read('sau sau')).toBeNull();
    expect(read('baasath feel')).toBeNull();
    expect(read('dedh')).toBeNull();
  });

  it('keeps 7 and 60 apart even though they sound alike', () => {
    expect(read('saat')).toBe(7);
    expect(read('saath')).toBe(60);
  });

  it('matches an unlisted spelling phonetically, and says so', () => {
    const result = parseNumberWords(['baasaath']);
    expect(result).toEqual({ value: 62, phonetic: true });
  });

  it('never resolves a sound two numbers share', () => {
    // "sattaees" (27) and "sattaasi" (87) share a phonetic key; an unlisted spelling
    // of either must not be read as one of them.
    expect(lookupNumberWord('sataasee')).toBeNull();
    expect(lookupNumberWord('sattaees')?.token).toEqual({ kind: 'unit', value: 27 });
    expect(lookupNumberWord('sattaasi')?.token).toEqual({ kind: 'unit', value: 87 });
  });

  it('lists every number from 1 to 99 in both scripts', () => {
    // Guards the hand-typed tables against a skipped or duplicated entry, which
    // would shift every number after it by one.
    expect(read('ek')).toBe(1);
    expect(read('das')).toBe(10);
    expect(read('bees')).toBe(20);
    expect(read('tees')).toBe(30);
    expect(read('chaalees')).toBe(40);
    expect(read('saath')).toBe(60);
    expect(read('assi')).toBe(80);
    expect(read('ایک')).toBe(1);
    expect(read('بیس')).toBe(20);
    expect(read('چالیس')).toBe(40);
    expect(read('اسی')).toBe(80);
    expect(read('ننانوے')).toBe(99);
  });
});
