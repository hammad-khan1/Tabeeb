"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { UserButton } from "@clerk/nextjs"
import {
  LayoutDashboard,
  FileText,
  MessageSquare,
  Clock,
  ShieldCheck,
  Pill,
  TrendingUp,
  Lightbulb,
  Settings,
  ClipboardCheck,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useLocale } from "@/components/providers/locale-provider";
import type { TranslationKey } from "@/lib/i18n";
import { TabeebLogo } from "@/components/brand"

const navItems: Array<{ href: string; key: TranslationKey; icon: React.ElementType }> = [
  { href: "/dashboard", key: "nav.dashboard", icon: LayoutDashboard },
  { href: "/documents", key: "nav.documents", icon: FileText },
  { href: "/chat", key: "nav.chat", icon: MessageSquare },
  { href: "/history", key: "nav.history", icon: Clock },
  { href: "/medications", key: "nav.medications", icon: Pill },
  { href: "/briefing", key: "nav.briefing", icon: ClipboardCheck },
  { href: "/interactions", key: "nav.interactions", icon: ShieldCheck },
  { href: "/trends", key: "nav.trends", icon: TrendingUp },
  { href: "/insights", key: "nav.insights", icon: Lightbulb },
  { href: "/settings", key: "nav.settings", icon: Settings },
]

export interface SidebarProps {
  collapsed?: boolean
}

export function Sidebar({ collapsed = false }: SidebarProps) {
  const { t } = useLocale();
  const pathname = usePathname()

  return (
    <aside className={cn(
      "hidden lg:flex lg:flex-col lg:border-e lg:border-border lg:bg-sidebar transition-all duration-200",
      collapsed ? "lg:w-16" : "lg:w-64"
    )}>
      {/* Branding */}
      <div className={cn(
        "flex h-14 items-center border-b border-border",
        collapsed ? "justify-center px-2" : "px-5"
      )}>
        {collapsed ? (
          <TabeebLogo variant="icon" size="sm" href="/dashboard" />
        ) : (
          <TabeebLogo variant="primary" size="md" href="/dashboard" priority />
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-2">
        <nav className="flex flex-col gap-0.5 px-3">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href))
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" />
                {t(item.key)}
              </Link>
            )
          })}
        </nav>
      </ScrollArea>

      {/* User */}
      <div className="border-t border-border p-4">
        <UserButton
          appearance={{
            elements: {
              userButtonTrigger: "w-full",
            },
          }}
          showName
        />
      </div>
    </aside>
  )
}
