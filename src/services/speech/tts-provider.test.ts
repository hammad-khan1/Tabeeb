import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GoogleTTSProvider,
  getTTSProvider,
  setTTSProvider,
  synthesizeSpeech,
} from './tts-provider';

describe('GoogleTTSProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports provider name and availability', async () => {
    const provider = new GoogleTTSProvider();
    expect(provider.name).toBe('GoogleTTS');
    expect(await provider.isAvailable()).toBe(true);
  });

  it('throws an error if given empty text', async () => {
    const provider = new GoogleTTSProvider();
    await expect(provider.synthesize('', 'en')).rejects.toThrow('No text to synthesize');
  });

  it('chunks text and synthesizes audio stream', async () => {
    const mockAudioBytes = new Uint8Array([0xff, 0xfb, 0x90, 0x64]); // mock MP3 header bytes
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => mockAudioBytes.buffer,
    } as unknown as Response);

    const provider = new GoogleTTSProvider();
    const result = await provider.synthesize(
      'Take Panadol 500 mg twice daily. Drink water.',
      'en'
    );

    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeGreaterThan(0);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('supports custom provider override via setTTSProvider', async () => {
    const customProvider = {
      name: 'CustomTestTTS',
      isAvailable: async () => true,
      synthesize: vi.fn().mockResolvedValue(Buffer.from('custom-mp3-data')),
    };

    setTTSProvider(customProvider);
    expect(getTTSProvider().name).toBe('CustomTestTTS');

    const result = await synthesizeSpeech('Test medicine', 'ur');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(result.buffer.toString()).toBe('custom-mp3-data');

    // Restore default
    setTTSProvider(new GoogleTTSProvider());
  });
});
