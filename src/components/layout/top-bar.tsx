"use client"

import { usePathname } from "next/navigation"
import { MobileNav } from "@/components/layout/mobile-nav"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { useLocale } from "@/components/providers/locale-provider"
import type { TranslationKey } from "@/lib/i18n"

const routeTitles: Record<string, TranslationKey> = {
  "/dashboard": "nav.dashboard",
  "/documents": "nav.documents",
  "/documents/upload": "action.upload",
  "/chat": "nav.chat",
  "/history": "nav.history",
  "/medications": "nav.medications",
  "/briefing": "nav.briefing",
  "/interactions": "nav.interactions",
  "/trends": "nav.trends",
  "/insights": "nav.insights",
  "/settings": "nav.settings",
}

function getTitleKey(pathname: string): TranslationKey | null {
  if (routeTitles[pathname]) return routeTitles[pathname]

  // Longest match first, so /documents/upload does not resolve to /documents.
  const match = Object.keys(routeTitles)
    .filter((route) => route !== "/dashboard" && pathname.startsWith(route))
    .sort((a, b) => b.length - a.length)[0]

  return match ? routeTitles[match] : null
}

export function TopBar() {
  const pathname = usePathname()
  const { t } = useLocale()
  const titleKey = getTitleKey(pathname)
  // Untranslated fallback for a route with no entry: the last path segment.
  const title = titleKey
    ? t(titleKey)
    : pathname.split("/").filter(Boolean).pop()?.replace(/^./, (c) => c.toUpperCase()) ?? "Tabeeb"

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/95 backdrop-blur-sm px-4 lg:px-6">
      <div className="flex items-center gap-3">
        {/* Mobile menu trigger */}
        <MobileNav />

        {/* Page title */}
        <h1 className="text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h1>
      </div>

      {/* Top-right header actions */}
      <div className="flex items-center gap-2">
        <ThemeToggle />
      </div>
    </header>
  )
}
