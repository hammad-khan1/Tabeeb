'use client';

import React, { useState } from 'react';
import {
  Volume2,
  VolumeX,
  Play,
  Pause,
  Square,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSpeechPlayer } from '@/hooks/use-speech-player';
import type { SpeechLanguage } from '@/services/speech/types';
import { cn } from '@/lib/utils';

export interface ReadAloudControlProps {
  messageId: string;
  content: string;
  className?: string;
}

export function ReadAloudControl({
  messageId,
  content,
  className,
}: ReadAloudControlProps) {
  const {
    activeLanguage,
    preferredLanguage,
    status,
    progress,
    errorMessage,
    play,
    pause,
    resume,
    stop,
    setPreferredLanguage,
    isCurrentMessageActive,
    isCurrentMessagePlaying,
    isCurrentMessageLoading,
  } = useSpeechPlayer();

  const [expanded, setExpanded] = useState(false);

  const isActive = isCurrentMessageActive(messageId);
  const isPlaying = isCurrentMessagePlaying(messageId);
  const isLoading = isCurrentMessageLoading(messageId);
  const isPaused = isActive && status === 'paused';
  const hasError = isActive && status === 'error' && !!errorMessage;

  // Selected language for this message (use activeLanguage if this message is active, else preferredLanguage)
  const currentLang = isActive ? activeLanguage : preferredLanguage;

  const handlePlay = (langToPlay?: SpeechLanguage) => {
    const lang = langToPlay || currentLang;
    setExpanded(true);
    play(messageId, content, lang);
  };

  const handleLanguageSwitch = (lang: SpeechLanguage) => {
    setPreferredLanguage(lang);
    if (isActive) {
      // Re-trigger playback in the newly selected language
      play(messageId, content, lang);
    }
  };

  const handleStop = () => {
    stop();
    setExpanded(false);
  };

  // Compact idle trigger button
  if (!expanded && !isActive) {
    return (
      <div className={cn('inline-flex items-center gap-1.5', className)}>
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
            handlePlay(preferredLanguage);
          }}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`Read aloud in ${preferredLanguage === 'ur' ? 'Urdu' : 'English'}`}
          title={`Listen to response in ${preferredLanguage === 'ur' ? 'Urdu (اردو)' : 'English'}`}
        >
          <Volume2 className="size-3.5" aria-hidden="true" />
          <span className="text-[11px]">Read Aloud</span>
          <span className="ms-0.5 rounded bg-muted px-1 py-0.2 text-[10px] font-semibold uppercase text-foreground/70">
            {preferredLanguage === 'ur' ? 'اردو' : 'EN'}
          </span>
        </button>
      </div>
    );
  }

  // Expanded interactive player controls
  return (
    <div
      className={cn(
        'mt-2.5 flex flex-col gap-1.5 rounded-xl border border-border/70 bg-background/80 p-2 shadow-xs backdrop-blur-xs transition-all sm:flex-row sm:items-center sm:justify-between',
        isActive && 'border-primary/40 bg-primary/5',
        className
      )}
      role="region"
      aria-label="Speech read aloud controls"
    >
      {/* Top / Left Controls: Language Selection + Play/Pause/Stop */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Language Switcher Tabs */}
        <div
          className="inline-flex items-center rounded-lg border border-border/80 bg-muted/50 p-0.5 text-xs"
          role="radiogroup"
          aria-label="Select speech language"
        >
          <button
            type="button"
            role="radio"
            aria-checked={currentLang === 'en'}
            onClick={() => handleLanguageSwitch('en')}
            className={cn(
              'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
              currentLang === 'en'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
            title="Read in English"
          >
            English
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={currentLang === 'ur'}
            onClick={() => handleLanguageSwitch('ur')}
            className={cn(
              'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors',
              currentLang === 'ur'
                ? 'bg-background text-foreground shadow-xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            )}
            title="اردو میں سنیں (Listen in Urdu)"
          >
            اردو (Urdu)
          </button>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center gap-1">
          {isLoading ? (
            <Button
              variant="outline"
              size="sm"
              disabled
              className="h-7 gap-1 px-2 text-xs"
              aria-label="Preparing audio"
            >
              <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
              <span className="text-[11px]">
                {currentLang === 'ur' ? 'Translating...' : 'Loading...'}
              </span>
            </Button>
          ) : isPlaying ? (
            <Button
              variant="default"
              size="sm"
              onClick={pause}
              className="h-7 gap-1 px-2.5 text-xs shadow-xs"
              aria-label="Pause speech"
            >
              <Pause className="size-3" aria-hidden="true" />
              <span className="text-[11px]">Pause</span>
            </Button>
          ) : isPaused ? (
            <Button
              variant="default"
              size="sm"
              onClick={resume}
              className="h-7 gap-1 px-2.5 text-xs shadow-xs"
              aria-label="Resume speech"
            >
              <Play className="size-3" aria-hidden="true" />
              <span className="text-[11px]">Resume</span>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePlay()}
              className="h-7 gap-1 px-2.5 text-xs hover:border-primary hover:text-primary"
              aria-label={`Play response in ${currentLang === 'ur' ? 'Urdu' : 'English'}`}
            >
              <Play className="size-3 text-primary" aria-hidden="true" />
              <span className="text-[11px]">Listen</span>
            </Button>
          )}

          {isActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleStop}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Stop speech"
              title="Stop playback"
            >
              <Square className="size-3 text-destructive" aria-hidden="true" />
              <span className="sr-only">Stop</span>
            </Button>
          )}

          {!isActive && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="ms-1 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label="Close speech controls"
              title="Close"
            >
              <VolumeX className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Right / Progress & Status Indicator */}
      {isActive && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground sm:max-w-[200px]">
          {isLoading ? (
            <span className="text-[11px] text-primary italic">
              {currentLang === 'ur' ? 'Preparing Urdu speech...' : 'Preparing speech...'}
            </span>
          ) : isPlaying || isPaused ? (
            <div className="flex flex-1 items-center gap-2">
              <div
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Speech playback progress"
              >
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{ width: `${Math.min(100, Math.max(5, progress))}%` }}
                />
              </div>
              <span className="text-[10px] font-mono tabular-nums">{progress}%</span>
            </div>
          ) : null}
        </div>
      )}

      {/* Error notification banner if any */}
      {hasError && (
        <div
          className="mt-1 flex w-full items-start gap-1.5 rounded-lg border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <span className="font-medium">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={stop}
            className="text-[11px] font-semibold underline hover:opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
