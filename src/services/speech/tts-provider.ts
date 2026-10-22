import type { ITTSProvider, SpeechLanguage } from './types';
import { cleanMarkdownForSpeech, chunkTextForSpeech } from './cleaner';

/**
 * Default zero-billing Google TTS Provider.
 * Fetches MP3 chunks and concatenates them into a single audio buffer.
 */
export class GoogleTTSProvider implements ITTSProvider {
  public readonly name = 'GoogleTTS';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async synthesize(text: string, lang: SpeechLanguage): Promise<Buffer> {
    const cleaned = cleanMarkdownForSpeech(text, {
      lang,
      expandUnits: lang === 'en',
    });

    if (!cleaned.trim()) {
      throw new Error('No text to synthesize');
    }

    // Google TTS query string limit is ~180 characters per chunk
    const chunks = chunkTextForSpeech(cleaned, 150);
    if (chunks.length === 0) {
      throw new Error('No valid speech chunks generated');
    }

    const audioBuffers: Buffer[] = [];

    for (const chunk of chunks) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://translate.google.com/',
        },
      });

      if (!response.ok) {
        throw new Error(
          `TTS upstream provider returned ${response.status}: ${response.statusText}`
        );
      }

      const arrayBuf = await response.arrayBuffer();
      audioBuffers.push(Buffer.from(arrayBuf));
    }

    return Buffer.concat(audioBuffers);
  }
}

let activeProvider: ITTSProvider = new GoogleTTSProvider();

export function setTTSProvider(provider: ITTSProvider): void {
  activeProvider = provider;
}

export function getTTSProvider(): ITTSProvider {
  return activeProvider;
}

export async function synthesizeSpeech(
  text: string,
  lang: SpeechLanguage
): Promise<{ buffer: Buffer; mimeType: string }> {
  const provider = getTTSProvider();
  const buffer = await provider.synthesize(text, lang);
  return {
    buffer,
    mimeType: 'audio/mpeg',
  };
}
