import { describe, it, expect } from 'vitest';
import {
  toLocale,
  directionFor,
  translate,
  createTranslator,
  UI_LOCALES,
} from './i18n';

/**
 * `preferredLanguage` used to be a dead setting — saved, returned by the API, and read
 * by nothing. These cover the mapping that now drives <html lang/dir> and the summary
 * language.
 */

describe('toLocale', () => {
  it('maps the stored preference to an interface locale', () => {
    expect(toLocale('ur')).toBe('ur');
    expect(toLocale('en')).toBe('en');
  });

  it('falls back to English for a mixed-language preference', () => {
    // "mixed" is meaningful for a document but not for chrome.
    expect(toLocale('mixed')).toBe('en');
  });

  it('falls back to English when unset', () => {
    expect(toLocale(null)).toBe('en');
    expect(toLocale(undefined)).toBe('en');
  });
});

describe('directionFor', () => {
  it('gives Urdu right-to-left', () => {
    expect(directionFor('ur')).toBe('rtl');
  });

  it('gives English left-to-right', () => {
    expect(directionFor('en')).toBe('ltr');
  });
});

describe('translate', () => {
  it('returns the Urdu string for an Urdu locale', () => {
    expect(translate('nav.dashboard', 'ur')).toBe('ڈیش بورڈ');
  });

  it('returns the English string for an English locale', () => {
    expect(translate('nav.dashboard', 'en')).toBe('Dashboard');
  });

  it('has a non-empty translation for every key in every locale', () => {
    const keys = [
      'nav.dashboard', 'nav.documents', 'nav.chat', 'nav.history',
      'nav.interactions', 'nav.trends', 'nav.insights', 'nav.settings',
      'action.upload', 'action.retry', 'error.title', 'error.body',
    ] as const;

    for (const locale of UI_LOCALES) {
      for (const key of keys) {
        const value = translate(key, locale);
        expect(value, `${key} in ${locale}`).toBeTruthy();
        expect(value.trim(), `${key} in ${locale}`).not.toBe('');
      }
    }
  });

  it('does not leave Urdu strings identical to their English source', () => {
    // A copy-paste that left English text under the `ur` key would silently ship an
    // untranslated interface.
    for (const key of ['nav.dashboard', 'nav.settings', 'error.title'] as const) {
      expect(translate(key, 'ur'), key).not.toBe(translate(key, 'en'));
    }
  });
});

describe('createTranslator', () => {
  it('binds a locale', () => {
    expect(createTranslator('ur')('nav.settings')).toBe('ترتیبات');
    expect(createTranslator('en')('nav.settings')).toBe('Settings');
  });
});
