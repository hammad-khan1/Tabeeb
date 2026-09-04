"use client";

import { createContext, useContext, useMemo } from "react";
import {
  createTranslator,
  directionFor,
  type Locale,
  type TranslationKey,
} from "@/lib/i18n";

interface LocaleContextValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  t: (key: TranslationKey) => string;
  /** True when the interface is Urdu, for components that need the Nastaliq face. */
  isUrdu: boolean;
}

/**
 * Defaults to English so a component rendered outside the provider (a test, an
 * unauthenticated page) still renders readable text rather than throwing.
 */
const LocaleContext = createContext<LocaleContextValue>({
  locale: "en",
  dir: "ltr",
  t: createTranslator("en"),
  isUrdu: false,
});

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      dir: directionFor(locale),
      t: createTranslator(locale),
      isUrdu: locale === "ur",
    }),
    [locale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}
