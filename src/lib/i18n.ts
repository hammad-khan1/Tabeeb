/**
 * Interface language.
 *
 * `users.preferredLanguage` was a dead setting: the Settings page saved it, the API
 * returned it, and nothing ever read it. The Urdu font was loaded and a `.font-urdu`
 * utility with `direction: rtl` sat in globals.css unused, while `<html lang="en">`
 * was hardcoded — so an Urdu-speaking patient got an English interface no matter what
 * they chose.
 *
 * `mixed` is a valid value for a *document* but not for the interface, so it maps to
 * English chrome here; a mixed-language document still gets its own treatment in the
 * summarizer.
 */

export const UI_LOCALES = ['en', 'ur'] as const;
export type Locale = (typeof UI_LOCALES)[number];

export type PreferredLanguage = 'en' | 'ur' | 'mixed';

export function toLocale(preference: PreferredLanguage | null | undefined): Locale {
  return preference === 'ur' ? 'ur' : 'en';
}

export function directionFor(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ur' ? 'rtl' : 'ltr';
}

/**
 * Translations. Medical terms and medicine names deliberately stay in Latin script
 * even in the Urdu interface — that is how they are printed on the box and on the
 * prescription, so translating them would make them harder to match, not easier.
 */
const STRINGS = {
  // ── Navigation ───────────────────────────────────────────────────────────
  'nav.dashboard': { en: 'Dashboard', ur: 'ڈیش بورڈ' },
  'nav.documents': { en: 'Documents', ur: 'دستاویزات' },
  'nav.chat': { en: 'Ask Tabeeb', ur: 'طبیب سے پوچھیں' },
  'nav.history': { en: 'History', ur: 'تاریخ' },
  'nav.interactions': { en: 'Interactions', ur: 'دواؤں کا تعامل' },
  'nav.trends': { en: 'Trends', ur: 'رجحانات' },
  'nav.insights': { en: 'Insights', ur: 'بصیرت' },
  'nav.settings': { en: 'Settings', ur: 'ترتیبات' },

  // ── Common actions ───────────────────────────────────────────────────────
  'action.upload': { en: 'Upload Document', ur: 'دستاویز اپ لوڈ کریں' },
  'action.save': { en: 'Save', ur: 'محفوظ کریں' },
  'action.saving': { en: 'Saving…', ur: 'محفوظ ہو رہا ہے…' },
  'action.cancel': { en: 'Cancel', ur: 'منسوخ کریں' },
  'action.delete': { en: 'Delete', ur: 'حذف کریں' },
  'action.reprocess': { en: 'Reprocess', ur: 'دوبارہ پروسیس کریں' },
  'action.retry': { en: 'Try again', ur: 'دوبارہ کوشش کریں' },
  'action.download': { en: 'Download', ur: 'ڈاؤن لوڈ کریں' },

  // ── Status ───────────────────────────────────────────────────────────────
  'status.loading': { en: 'Loading…', ur: 'لوڈ ہو رہا ہے…' },
  'status.processing': { en: 'Processing', ur: 'پروسیس ہو رہا ہے' },
  'status.pending': { en: 'Pending', ur: 'زیرِ التوا' },
  'status.needsReview': { en: 'Needs review', ur: 'جانچ درکار ہے' },
  'status.confirmed': { en: 'Confirmed', ur: 'تصدیق شدہ' },
  'status.failed': { en: 'Failed', ur: 'ناکام' },

  // ── Settings ─────────────────────────────────────────────────────────────
  'settings.title': { en: 'Settings', ur: 'ترتیبات' },
  'settings.language': { en: 'Language', ur: 'زبان' },
  'settings.languageHelp': {
    en: 'Changes the app interface and the language your document summaries are written in.',
    ur: 'اس سے ایپ کا انٹرفیس اور آپ کی دستاویزات کے خلاصے کی زبان بدل جاتی ہے۔',
  },
  'settings.email': { en: 'Email', ur: 'ای میل' },
  'settings.allergies': { en: 'Known allergies', ur: 'معلوم الرجی' },
  'settings.conditions': { en: 'Known conditions', ur: 'معلوم بیماریاں' },
  'settings.deleteAll': { en: 'Delete all data', ur: 'تمام ڈیٹا حذف کریں' },

  // ── Errors ───────────────────────────────────────────────────────────────
  'error.title': { en: 'Something went wrong', ur: 'کچھ غلط ہو گیا' },
  'error.body': {
    en: 'This page could not be displayed. Your medical records are safe — nothing was changed.',
    ur: 'یہ صفحہ نہیں دکھایا جا سکا۔ آپ کا طبی ریکارڈ محفوظ ہے — کچھ تبدیل نہیں ہوا۔',
  },
  'error.notFound': { en: 'Page not found', ur: 'صفحہ نہیں ملا' },
  'error.notFoundBody': {
    en: 'The page you are looking for does not exist or has been moved.',
    ur: 'آپ جو صفحہ تلاش کر رہے ہیں وہ موجود نہیں یا منتقل ہو چکا ہے۔',
  },
  'error.backToDashboard': { en: 'Back to dashboard', ur: 'ڈیش بورڈ پر واپس' },
} as const;

export type TranslationKey = keyof typeof STRINGS;

export function translate(key: TranslationKey, locale: Locale): string {
  const entry = STRINGS[key];
  // Fall back to English rather than showing a raw key if a translation is missing.
  return entry[locale] ?? entry.en;
}

/** The `t` used across the app. */
export function createTranslator(locale: Locale) {
  return (key: TranslationKey): string => translate(key, locale);
}
