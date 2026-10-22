import type { SpeechLanguage, SpeechPlaybackStatus } from './types';
import { cleanMarkdownForSpeech, chunkTextForSpeech } from './cleaner';

export interface SpeechPlayerState {
  activeMessageId: string | null;
  activeLanguage: SpeechLanguage;
  preferredLanguage: SpeechLanguage;
  status: SpeechPlaybackStatus;
  progress: number; // 0 to 100
  errorMessage: string | null;
  translatedCache: Record<string, string>; // messageId -> translated Urdu text
}

const STORAGE_KEY = 'tabeeb_read_aloud_lang';

function getInitialLanguage(): SpeechLanguage {
  if (typeof window === 'undefined') return 'en';
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved === 'ur' || saved === 'en') return saved;
  } catch {
    // sessionStorage not available or quota exceeded
  }
  return 'en';
}

class SpeechPlayerStore {
  private state: SpeechPlayerState = {
    activeMessageId: null,
    activeLanguage: getInitialLanguage(),
    preferredLanguage: getInitialLanguage(),
    status: 'idle',
    progress: 0,
    errorMessage: null,
    translatedCache: {},
  };

  private listeners = new Set<() => void>();

  // Browser speech synthesis state
  private speechUtterances: SpeechSynthesisUtterance[] = [];
  private currentUtteranceIndex = 0;
  private isSynthesizingWithSpeechApi = false;

  // HTML5 Audio element state (used for server-side synthesized audio)
  private audioElement: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.stop());
    }
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public getState = (): SpeechPlayerState => {
    return this.state;
  };

  private setState(updates: Partial<SpeechPlayerState>): void {
    this.state = { ...this.state, ...updates };
    this.listeners.forEach((listener) => listener());
  }

  public setPreferredLanguage(lang: SpeechLanguage): void {
    try {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(STORAGE_KEY, lang);
      }
    } catch {
      // ignore storage errors
    }
    this.setState({ preferredLanguage: lang });
  }

  /**
   * Checks whether the current browser's Web Speech API has a native Urdu voice.
   */
  public hasBrowserUrduVoice(): boolean {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return false;
    }
    const voices = window.speechSynthesis.getVoices();
    return voices.some(
      (v) =>
        v.lang.toLowerCase().startsWith('ur') ||
        v.name.toLowerCase().includes('urdu')
    );
  }

  private getBrowserVoice(lang: SpeechLanguage): SpeechSynthesisVoice | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return null;
    }
    const voices = window.speechSynthesis.getVoices();
    if (lang === 'ur') {
      return (
        voices.find(
          (v) =>
            v.lang.toLowerCase().startsWith('ur') ||
            v.name.toLowerCase().includes('urdu')
        ) || null
      );
    }
    // English: prefer natural/local voice if available
    return (
      voices.find((v) => v.lang.toLowerCase().startsWith('en-') && !v.localService) ||
      voices.find((v) => v.lang.toLowerCase().startsWith('en')) ||
      null
    );
  }

  public stop(): void {
    // Abort pending network fetch if any
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Cancel Web Speech API
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.speechUtterances = [];
    this.currentUtteranceIndex = 0;
    this.isSynthesizingWithSpeechApi = false;

    // Stop HTML5 Audio
    if (this.audioElement) {
      this.audioElement.pause();
      this.audioElement.src = '';
      this.audioElement = null;
    }
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }

    this.setState({
      activeMessageId: null,
      status: 'idle',
      progress: 0,
      errorMessage: null,
    });
  }

  public pause(): void {
    if (this.state.status !== 'playing') return;

    if (this.isSynthesizingWithSpeechApi && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.pause();
      this.setState({ status: 'paused' });
    } else if (this.audioElement) {
      this.audioElement.pause();
      this.setState({ status: 'paused' });
    }
  }

  public resume(): void {
    if (this.state.status !== 'paused') return;

    if (this.isSynthesizingWithSpeechApi && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.resume();
      this.setState({ status: 'playing' });
    } else if (this.audioElement) {
      this.audioElement.play().then(() => {
        this.setState({ status: 'playing' });
      }).catch((err) => {
        this.setState({
          status: 'error',
          errorMessage: err instanceof Error ? err.message : 'Playback failed to resume',
        });
      });
    }
  }

  public async play(messageId: string, rawContent: string, lang?: SpeechLanguage): Promise<void> {
    const targetLang = lang || this.state.preferredLanguage;

    // If already playing this message in the same language, toggle pause/resume
    if (this.state.activeMessageId === messageId && this.state.activeLanguage === targetLang) {
      if (this.state.status === 'playing') {
        this.pause();
        return;
      }
      if (this.state.status === 'paused') {
        this.resume();
        return;
      }
    }

    // Stop previous playback
    this.stop();

    // Remember preferred language
    this.setPreferredLanguage(targetLang);

    this.setState({
      activeMessageId: messageId,
      activeLanguage: targetLang,
      status: 'loading',
      progress: 0,
      errorMessage: null,
    });

    this.abortController = new AbortController();

    try {
      if (targetLang === 'en') {
        await this.playEnglish(rawContent);
      } else {
        await this.playUrdu(messageId, rawContent);
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      this.setState({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Unable to play speech',
      });
    }
  }

  private async playEnglish(rawContent: string): Promise<void> {
    const cleanedText = cleanMarkdownForSpeech(rawContent, {
      lang: 'en',
      expandUnits: true,
    });

    if (!cleanedText) {
      throw new Error('No readable content in this message');
    }

    // Use Web Speech API if available
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const chunks = chunkTextForSpeech(cleanedText, 180);
      if (chunks.length === 0) {
        throw new Error('Failed to parse text into speech chunks');
      }

      this.isSynthesizingWithSpeechApi = true;
      this.currentUtteranceIndex = 0;
      const totalChunks = chunks.length;
      const voice = this.getBrowserVoice('en');

      this.speechUtterances = chunks.map((chunk, index) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.lang = 'en-US';
        utterance.rate = 0.95; // Clear healthcare speaking pace
        if (voice) utterance.voice = voice;

        utterance.onstart = () => {
          this.currentUtteranceIndex = index;
          this.setState({
            status: 'playing',
            progress: Math.round(((index + 0.5) / totalChunks) * 100),
          });
        };

        utterance.onend = () => {
          if (index === totalChunks - 1) {
            this.setState({ status: 'idle', progress: 100, activeMessageId: null });
          } else {
            this.setState({
              progress: Math.round(((index + 1) / totalChunks) * 100),
            });
          }
        };

        utterance.onerror = (e) => {
          if (e.error === 'interrupted' || e.error === 'canceled') return;
          this.setState({
            status: 'error',
            errorMessage: `Speech error: ${e.error || 'Playback failed'}`,
          });
        };

        return utterance;
      });

      // Begin speaking
      window.speechSynthesis.cancel();
      this.speechUtterances.forEach((u) => window.speechSynthesis.speak(u));
      this.setState({ status: 'playing' });
    } else {
      // Fallback to server-side TTS
      await this.playViaServerAudio(cleanedText, 'en');
    }
  }

  private async playUrdu(messageId: string, rawContent: string): Promise<void> {
    // 1. Check or fetch Urdu translation
    let urduText = this.state.translatedCache[messageId];

    if (!urduText) {
      const res = await fetch('/api/speech/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawContent }),
        signal: this.abortController?.signal,
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(
          errorJson.error || 'Failed to translate message to Urdu'
        );
      }

      const data = await res.json();
      urduText = data.translatedText;

      this.setState({
        translatedCache: {
          ...this.state.translatedCache,
          [messageId]: urduText,
        },
      });
    }

    if (!urduText || !urduText.trim()) {
      throw new Error('Urdu translation is empty');
    }

    // 2. Determine voice method:
    // If browser has a native Urdu voice, use Web Speech API
    const urduVoice = this.getBrowserVoice('ur');

    if (urduVoice && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const chunks = chunkTextForSpeech(urduText, 150);
      this.isSynthesizingWithSpeechApi = true;
      this.currentUtteranceIndex = 0;
      const totalChunks = chunks.length;

      this.speechUtterances = chunks.map((chunk, index) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.voice = urduVoice;
        utterance.lang = urduVoice.lang || 'ur-PK';
        utterance.rate = 0.95;

        utterance.onstart = () => {
          this.currentUtteranceIndex = index;
          this.setState({
            status: 'playing',
            progress: Math.round(((index + 0.5) / totalChunks) * 100),
          });
        };

        utterance.onend = () => {
          if (index === totalChunks - 1) {
            this.setState({ status: 'idle', progress: 100, activeMessageId: null });
          } else {
            this.setState({
              progress: Math.round(((index + 1) / totalChunks) * 100),
            });
          }
        };

        utterance.onerror = (e) => {
          if (e.error === 'interrupted' || e.error === 'canceled') return;
          this.setState({
            status: 'error',
            errorMessage: `Speech error: ${e.error || 'Playback failed'}`,
          });
        };

        return utterance;
      });

      window.speechSynthesis.cancel();
      this.speechUtterances.forEach((u) => window.speechSynthesis.speak(u));
      this.setState({ status: 'playing' });
    } else {
      // Browser lacks an Urdu voice -> use server-side Urdu TTS audio stream!
      await this.playViaServerAudio(urduText, 'ur');
    }
  }

  private async playViaServerAudio(text: string, lang: SpeechLanguage): Promise<void> {
    const res = await fetch('/api/speech/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, lang }),
      signal: this.abortController?.signal,
    });

    if (!res.ok) {
      const errorJson = await res.json().catch(() => ({}));
      throw new Error(
        errorJson.error ||
          (lang === 'ur'
            ? 'Urdu voice is not installed on your browser and the speech service could not be reached.'
            : 'Audio synthesis failed.')
      );
    }

    const blob = await res.blob();
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
    }
    this.audioUrl = URL.createObjectURL(blob);

    this.audioElement = new Audio(this.audioUrl);

    this.audioElement.addEventListener('timeupdate', () => {
      if (this.audioElement && this.audioElement.duration > 0) {
        const pct = Math.round(
          (this.audioElement.currentTime / this.audioElement.duration) * 100
        );
        this.setState({ progress: pct });
      }
    });

    this.audioElement.addEventListener('ended', () => {
      this.setState({
        status: 'idle',
        progress: 100,
        activeMessageId: null,
      });
    });

    this.audioElement.addEventListener('error', () => {
      this.setState({
        status: 'error',
        errorMessage: 'Audio playback failed',
      });
    });

    await this.audioElement.play();
    this.setState({ status: 'playing' });
  }
}

export const speechPlayerStore = new SpeechPlayerStore();
