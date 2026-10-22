// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReadAloudControl } from './read-aloud-control';
import { speechPlayerStore } from '@/services/speech/speech-player-store';

describe('ReadAloudControl Component', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    speechPlayerStore.stop();
  });

  afterEach(() => {
    act(() => {
      speechPlayerStore.stop();
      root.unmount();
    });
    container.remove();
  });

  it('renders compact Read Aloud button in idle state', () => {
    act(() => {
      root.render(
        <ReadAloudControl
          messageId="test-msg-1"
          content="Take Panadol 500 mg twice daily."
        />
      );
    });

    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain('Read Aloud');
  });

  it('expands controls when Read Aloud button is clicked', () => {
    act(() => {
      root.render(
        <ReadAloudControl
          messageId="test-msg-1"
          content="Take Panadol 500 mg twice daily."
        />
      );
    });

    const triggerButton = container.querySelector('button');
    act(() => {
      triggerButton?.click();
    });

    // Language options should be visible
    expect(container.textContent).toContain('English');
    expect(container.textContent).toContain('اردو (Urdu)');

    // ARIA roles
    const region = container.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-label')).toBe('Speech read aloud controls');

    const radioGroup = container.querySelector('[role="radiogroup"]');
    expect(radioGroup).not.toBeNull();
  });

  it('switches preferred language when Urdu or English option is selected', () => {
    act(() => {
      root.render(
        <ReadAloudControl
          messageId="test-msg-1"
          content="Take Panadol 500 mg twice daily."
        />
      );
    });

    // Expand
    const triggerButton = container.querySelector('button');
    act(() => {
      triggerButton?.click();
    });

    // Find Urdu radio button
    const urduRadio = Array.from(container.querySelectorAll('[role="radio"]')).find(
      (btn) => btn.textContent?.includes('اردو')
    ) as HTMLButtonElement | undefined;

    expect(urduRadio).toBeDefined();

    act(() => {
      urduRadio?.click();
    });

    expect(speechPlayerStore.getState().preferredLanguage).toBe('ur');
  });

  it('stops playback and cleans up when stop button is pressed', () => {
    act(() => {
      root.render(
        <ReadAloudControl
          messageId="test-msg-1"
          content="Take Panadol 500 mg twice daily."
        />
      );
    });

    // Expand
    act(() => {
      container.querySelector('button')?.click();
    });

    // Simulate active playing state
    act(() => {
      speechPlayerStore['setState']({
        activeMessageId: 'test-msg-1',
        status: 'playing',
        progress: 50,
      });
    });

    expect(container.textContent).toContain('Pause');
    expect(container.textContent).toContain('50%');

    // Click stop button
    const stopBtn = container.querySelector('button[aria-label="Stop speech"]') as HTMLButtonElement;
    expect(stopBtn).not.toBeNull();

    act(() => {
      stopBtn.click();
    });

    expect(speechPlayerStore.getState().status).toBe('idle');
    expect(speechPlayerStore.getState().activeMessageId).toBeNull();
  });
});
