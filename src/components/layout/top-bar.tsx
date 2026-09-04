"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MobileNav } from "@/components/layout/mobile-nav"
import { useLocale } from "@/components/providers/locale-provider"
import type { TranslationKey } from "@/lib/i18n"

const routeTitles: Record<string, TranslationKey> = {
  "/dashboard": "nav.dashboard",
  "/documents": "nav.documents",
  "/documents/upload": "action.upload",
  "/chat": "nav.chat",
  "/history": "nav.history",
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
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/95 backdrop-blur-sm px-4 lg:px-6">
      {/* Mobile menu trigger */}
      <MobileNav />

      {/* Page title */}
      <h1 className="text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h1>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Upload button */}
      <Button render={<Link href="/documents/upload" />} size="sm">
        <Upload className="size-4" />
        <span className="hidden sm:inline">Upload</span>
      </Button>
    </header>
  )
}
