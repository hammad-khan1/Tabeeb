"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronDown, Moon, SlidersHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { useLocale } from "@/components/providers/locale-provider"
import type { TranslationKey } from "@/lib/i18n"

/** Optional modes grouped under "Options" so the main navigation stays short. */
const optionItems: Array<{ href: string; key: TranslationKey; icon: React.ElementType }> = [
  { href: "/ramadan", key: "nav.ramadan", icon: Moon },
]

export interface NavLinkProps {
  href: string
  className: string
  children: React.ReactNode
}

function PlainLink({ href, className, children }: NavLinkProps) {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  )
}

/**
 * The "Options" entry and its drop-down. It opens on its own when the current page is
 * one of its items, so the active page is never hidden inside a closed group.
 * `LinkComponent` lets the mobile sheet close itself when an item is chosen.
 */
export function NavOptions({ LinkComponent = PlainLink }: { LinkComponent?: React.ComponentType<NavLinkProps> }) {
  const { t } = useLocale()
  const pathname = usePathname()
  const listId = useId()

  const containsActive = optionItems.some((item) => pathname.startsWith(item.href))
  const [open, setOpen] = useState(containsActive)
  const expanded = open || containsActive

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setOpen(!expanded)}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          containsActive
            ? "text-sidebar-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        )}
      >
        <SlidersHorizontal className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-start">{t("nav.options")}</span>
        <ChevronDown
          className={cn("size-4 shrink-0 transition-transform", expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {expanded && (
        <ul id={listId} className="mt-0.5 flex flex-col gap-0.5">
          {optionItems.map((item) => {
            const isActive = pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <li key={item.href}>
                <LinkComponent
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg py-2 ps-9 pe-3 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {t(item.key)}
                </LinkComponent>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
