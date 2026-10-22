export type SpeechLanguage = 'en' | 'ur';

export type SpeechPlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export interface SpeechPreparationOptions {
  lang?: SpeechLanguage;
  expandUnits?: boolean;
}

export interface TranslationResult {
  translatedText: string;
  language: 'ur';
}

export interface ITTSProvider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  synthesize(text: string, lang: SpeechLanguage): Promise<Buffer>;
}
