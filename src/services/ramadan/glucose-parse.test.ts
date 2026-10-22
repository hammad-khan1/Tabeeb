import { describe, it, expect, vi } from 'vitest';
import { parseGlucose, parseGlucoseText, type ReadingExtractor } from './glucose-parse';

describe('parseGlucoseText', () => {
  it('reads a typed English reading', () => {
    expect(parseGlucoseText('sugar 62')).toMatchObject({
      ok: true,
      value: 62,
      unit: 'mg_dl',
      valueMgDl: 62,
      needsConfirmation: false,
      method: 'digits',
    });
  });

  it('reads Urdu script with Eastern digits', () => {
    expect(parseGlucoseText('شوگر ۶۲')).toMatchObject({ ok: true, value: 62, unit: 'mg_dl' });
    expect(parseGlucoseText('میری شوگر ۱۸۰ ہے')).toMatchObject({ ok: true, value: 180 });
  });

  it('reads Roman-Urdu number words', () => {
    expect(parseGlucoseText('sugar baasath hai')).toMatchObject({
      ok: true,
      value: 62,
      unit: 'mg_dl',
      needsConfirmation: false,
      method: 'words',
    });
    expect(parseGlucoseText('meri sugar do sau bees hai')).toMatchObject({ ok: true, value: 220 });
  });

  it('reads Urdu-script number words', () => {
    expect(parseGlucoseText('شوگر باسٹھ ہے')).toMatchObject({ ok: true, value: 62 });
  });

  it('reads mmol/L and converts it', () => {
    const result = parseGlucoseText('4.1 mmol');
    expect(result).toMatchObject({ ok: true, value: 4.1, unit: 'mmol_l', needsConfirmation: false });
    if (result.ok) expect(result.valueMgDl).toBeCloseTo(73.87, 2);
  });

  it('reads a number with the unit stuck to it', () => {
    expect(parseGlucoseText('sugar 250mg/dl')).toMatchObject({ ok: true, value: 250, unit: 'mg_dl' });
  });

  it('treats a unitless decimal as mmol/L but asks to confirm', () => {
    expect(parseGlucoseText('sugar 4.1')).toMatchObject({ ok: true, unit: 'mmol_l', needsConfirmation: true });
  });

  it('will not guess the unit of a small unitless number', () => {
    // 30 mg/dL is a dangerous low and 30 mmol/L a dangerous high.
    expect(parseGlucoseText('sugar 30')).toEqual({ ok: false, reason: 'ambiguous_unit', value: 30 });
    expect(parseGlucoseText('sugar 30 mg/dl')).toMatchObject({ ok: true, unit: 'mg_dl' });
  });

  it('rejects numbers no glucometer shows', () => {
    expect(parseGlucoseText('sugar 900')).toEqual({ ok: false, reason: 'out_of_range', value: 900 });
    expect(parseGlucoseText('50 mmol')).toEqual({ ok: false, reason: 'out_of_range', value: 50 });
  });

  it('does not pick one of several numbers', () => {
    expect(parseGlucoseText('subah 8 baje sugar 62 thi')).toEqual({ ok: false, reason: 'multiple_numbers' });
  });

  it('does not read number words out of an ordinary sentence', () => {
    // "do" is 2 in Roman Urdu. Read out of this sentence, it would raise a low alert.
    expect(parseGlucoseText('I do feel shaky')).toEqual({ ok: false, reason: 'no_number' });
    expect(parseGlucoseText('sugar')).toEqual({ ok: false, reason: 'no_number' });
  });
});

describe('parseGlucose', () => {
  it('does not call the model when the text is readable', async () => {
    const extract = vi.fn<ReadingExtractor>();
    const result = await parseGlucose('sugar 62', extract);

    expect(result).toMatchObject({ ok: true, value: 62 });
    expect(extract).not.toHaveBeenCalled();
  });

  it('asks the model only for text it cannot read, and always asks the patient to confirm', async () => {
    const extract = vi.fn<ReadingExtractor>().mockResolvedValue({ value: 62, unit: null });
    const result = await parseGlucose('meter pe likha aa raha tha bayasath', extract);

    expect(extract).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, value: 62, unit: 'mg_dl', method: 'llm', needsConfirmation: true });
  });

  it('applies the same unit and range rules to the model', async () => {
    const small = vi.fn<ReadingExtractor>().mockResolvedValue({ value: 30, unit: null });
    expect(await parseGlucose('kuch samajh nahi aa raha', small)).toMatchObject({ ok: false, reason: 'ambiguous_unit' });

    const huge = vi.fn<ReadingExtractor>().mockResolvedValue({ value: 5000, unit: 'mg_dl' });
    expect(await parseGlucose('kuch samajh nahi aa raha', huge)).toMatchObject({ ok: false, reason: 'out_of_range' });
  });

  it('does not ask the model to settle a unit only the patient knows', async () => {
    const extract = vi.fn<ReadingExtractor>();
    expect(await parseGlucose('sugar 30', extract)).toMatchObject({ ok: false, reason: 'ambiguous_unit' });
    expect(extract).not.toHaveBeenCalled();
  });

  it('reports no reading when the model finds none', async () => {
    const extract = vi.fn<ReadingExtractor>().mockResolvedValue({ value: null, unit: null });
    expect(await parseGlucose('aaj roza hai', extract)).toEqual({ ok: false, reason: 'no_number' });
  });

  it('rejects a malformed model answer', async () => {
    const extract = vi.fn<ReadingExtractor>().mockResolvedValue({ value: 'sixty' } as never);
    await expect(parseGlucose('aaj roza hai', extract)).rejects.toThrow();
  });
});
