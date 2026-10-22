import { describe, it, expect } from 'vitest';
import { parseFrequency } from './frequency';

function parts(text: string) {
  return parseFrequency(text).dayParts;
}

describe('parseFrequency', () => {
  describe('plus and dash notation', () => {
    it('reads 1+0+1 as morning and night', () => {
      expect(parts('1+0+1')).toEqual(['morning', 'night']);
    });

    it('reads 1+1+1 as three times', () => {
      expect(parts('1+1+1')).toEqual(['morning', 'afternoon', 'night']);
    });

    it('reads 0+0+1 as night only', () => {
      expect(parts('0+0+1')).toEqual(['night']);
    });

    it('reads 1+0+0 and 0+1+0', () => {
      expect(parts('1+0+0')).toEqual(['morning']);
      expect(parts('0+1+0')).toEqual(['afternoon']);
    });

    it('reads dashes, spaces and four places', () => {
      expect(parts('1 - 0 - 1')).toEqual(['morning', 'night']);
      expect(parts('1+1+1+1')).toEqual(['morning', 'afternoon', 'evening', 'night']);
    });

    it('reads half tablets as a dose at that time', () => {
      expect(parts('½+0+½')).toEqual(['morning', 'night']);
      expect(parts('1/2+0+1')).toEqual(['morning', 'night']);
      expect(parts('0.5+0+0')).toEqual(['morning']);
    });

    it('reads the notation inside a longer line', () => {
      expect(parts('Tab Daonil 5mg 1+0+1 khane ke baad')).toEqual(['morning', 'night']);
    });

    it('does not read a date as a dose pattern', () => {
      expect(parseFrequency('2025-03-01').recognised).toBe(false);
    });
  });

  describe('Roman-Urdu words', () => {
    it('reads subah, dopahar, shaam and raat', () => {
      expect(parts('subah')).toEqual(['morning']);
      expect(parts('dopahar')).toEqual(['afternoon']);
      expect(parts('shaam')).toEqual(['evening']);
      expect(parts('raat ko')).toEqual(['night']);
      expect(parts('subah shaam')).toEqual(['morning', 'evening']);
    });

    it('reads khane ke baad and khane se pehle', () => {
      expect(parseFrequency('khane ke baad').withFood).toBe('after');
      expect(parseFrequency('khane se pehle').withFood).toBe('before');
    });

    it('reads sone se pehle as night', () => {
      expect(parts('sone se pehle')).toEqual(['night']);
    });
  });

  describe('Urdu script', () => {
    it('reads صبح، دوپہر، شام and رات', () => {
      expect(parts('صبح')).toEqual(['morning']);
      expect(parts('دوپہر')).toEqual(['afternoon']);
      expect(parts('شام')).toEqual(['evening']);
      expect(parts('رات')).toEqual(['night']);
      expect(parts('صبح شام')).toEqual(['morning', 'evening']);
    });

    it('reads کھانے کے بعد and کھانے سے پہلے', () => {
      expect(parseFrequency('کھانے کے بعد').withFood).toBe('after');
      expect(parseFrequency('کھانے سے پہلے').withFood).toBe('before');
    });

    it('reads Urdu counts', () => {
      expect(parseFrequency('دن میں دو بار').timesPerDay).toBe(2);
    });
  });

  describe('English abbreviations', () => {
    it('reads OD, BD, TDS and QID as counts, not times', () => {
      expect(parseFrequency('OD')).toMatchObject({ timesPerDay: 1, dayParts: [] });
      expect(parseFrequency('BD')).toMatchObject({ timesPerDay: 2, dayParts: [] });
      expect(parseFrequency('TDS')).toMatchObject({ timesPerDay: 3, dayParts: [] });
      expect(parseFrequency('QID')).toMatchObject({ timesPerDay: 4, dayParts: [] });
    });

    it('reads HS as night', () => {
      expect(parts('HS')).toEqual(['night']);
    });
  });

  describe('Ramzan prescriptions', () => {
    it('reads sehri and iftar in both scripts', () => {
      expect(parseFrequency('iftar').ramadanSlots).toEqual(['iftar']);
      expect(parseFrequency('sehri aur iftar').ramadanSlots).toEqual(['sehri', 'iftar']);
      expect(parseFrequency('سحری').ramadanSlots).toEqual(['sehri']);
      expect(parseFrequency('افطار کے وقت').ramadanSlots).toEqual(['iftar']);
    });
  });

  it('reports text it cannot read', () => {
    expect(parseFrequency('as directed').recognised).toBe(false);
    expect(parseFrequency(null).recognised).toBe(false);
    expect(parseFrequency('').recognised).toBe(false);
  });
});
