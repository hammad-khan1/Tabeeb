'use client';

import { useSyncExternalStore, useCallback } from 'react';
import {
  speechPlayerStore,
  type SpeechPlayerState,
} from '@/services/speech/speech-player-store';
import type { SpeechLanguage } from '@/services/speech/types';

export function useSpeechPlayer() {
  const state: SpeechPlayerState = useSyncExternalStore(
    speechPlayerStore.subscribe,
    speechPlayerStore.getState,
    // Server snapshot for SSR hydration safety
    (): SpeechPlayerState => ({
      activeMessageId: null,
      activeLanguage: 'en',
      preferredLanguage: 'en',
      status: 'idle',
      progress: 0,
      errorMessage: null,
      translatedCache: {},
    })
  );

  const play = useCallback(
    (messageId: string, text: string, lang?: SpeechLanguage) => {
      speechPlayerStore.play(messageId, text, lang);
    },
    []
  );

  const pause = useCallback(() => {
    speechPlayerStore.pause();
  }, []);

  const resume = useCallback(() => {
    speechPlayerStore.resume();
  }, []);

  const stop = useCallback(() => {
    speechPlayerStore.stop();
  }, []);

  const setPreferredLanguage = useCallback((lang: SpeechLanguage) => {
    speechPlayerStore.setPreferredLanguage(lang);
  }, []);

  return {
    ...state,
    play,
    pause,
    resume,
    stop,
    setPreferredLanguage,
    isCurrentMessageActive: (id: string) => state.activeMessageId === id,
    isCurrentMessagePlaying: (id: string) =>
      state.activeMessageId === id && state.status === 'playing',
    isCurrentMessageLoading: (id: string) =>
      state.activeMessageId === id && state.status === 'loading',
  };
}
