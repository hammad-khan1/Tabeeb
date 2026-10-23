import { describe, it, expect, vi } from 'vitest';
import { interpretVoiceAnswer, type OptionChooser } from './voice-answer';

describe('interpretVoiceAnswer', () => {
  it("returns the model's choice when it is one of the question's options", async () => {
    const choose = vi.fn<OptionChooser>().mockResolvedValue({ option: 'none' });
    expect(await interpretVoiceAnswer('physical_labour', 'main koi mehnat wala kaam nahi karta', choose)).toBe('none');

    const [prompt] = choose.mock.calls[0];
    expect(prompt).toContain('Physical labour');
    expect(prompt).toContain('- moderate: Moderately intense physical labour');
  });

  it("rejects an option from a different question", async () => {
    const choose = vi.fn<OptionChooser>().mockResolvedValue({ option: 'over_9' });
    expect(await interpretVoiceAnswer('physical_labour', 'kuch bhi', choose)).toBeNull();
  });

  it('passes on "no clear match"', async () => {
    const choose = vi.fn<OptionChooser>().mockResolvedValue({ option: null });
    expect(await interpretVoiceAnswer('pregnancy', 'pata nahi', choose)).toBeNull();
  });

  it('treats a malformed answer as no match', async () => {
    const choose = vi.fn<OptionChooser>().mockResolvedValue('moderate');
    expect(await interpretVoiceAnswer('physical_labour', 'kuch bhi', choose)).toBeNull();
  });
});
