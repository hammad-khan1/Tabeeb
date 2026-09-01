"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MobileNav } from "@/components/layout/mobile-nav"

const routeTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/documents": "Documents",
  "/documents/upload": "Upload Document",
  "/chat": "Ask Tabeeb",
  "/history": "History",
  "/interactions": "Interactions",
  "/trends": "Trends",
  "/insights": "Insights",
  "/settings": "Settings",
}

function getPageTitle(pathname: string): string {
  if (routeTitles[pathname]) return routeTitles[pathname]

  // Check for sub-routes (e.g. /documents/[id])
  for (const [route, title] of Object.entries(routeTitles)) {
    if (pathname.startsWith(route) && route !== "/dashboard") return title
  }

  // Fallback: capitalize the last segment
  const segment = pathname.split("/").filter(Boolean).pop()
  return segment ? segment.charAt(0).toUpperCase() + segment.slice(1) : "Tabeeb"
}

export function TopBar() {
  const pathname = usePathname()
  const title = getPageTitle(pathname)

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
