"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { UserButton } from "@clerk/nextjs"
import {
  Activity,
  LayoutDashboard,
  FileText,
  MessageSquare,
  Clock,
  ShieldCheck,
  TrendingUp,
  Lightbulb,
  Settings,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useLocale } from "@/components/providers/locale-provider";
import type { TranslationKey } from "@/lib/i18n";

const navItems: Array<{ href: string; key: TranslationKey; icon: React.ElementType }> = [
  { href: "/dashboard", key: "nav.dashboard", icon: LayoutDashboard },
  { href: "/documents", key: "nav.documents", icon: FileText },
  { href: "/chat", key: "nav.chat", icon: MessageSquare },
  { href: "/history", key: "nav.history", icon: Clock },
  { href: "/interactions", key: "nav.interactions", icon: ShieldCheck },
  { href: "/trends", key: "nav.trends", icon: TrendingUp },
  { href: "/insights", key: "nav.insights", icon: Lightbulb },
  { href: "/settings", key: "nav.settings", icon: Settings },
]

export function Sidebar() {
  const { t } = useLocale();
  const pathname = usePathname()

  return (
    <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:border-e lg:border-border lg:bg-sidebar">
      {/* Branding */}
      <div className="flex h-14 items-center gap-2.5 px-5 border-b border-border">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Activity className="size-4.5" />
        </div>
        <span className="text-lg font-semibold tracking-tight text-sidebar-foreground">
          Tabeeb
        </span>
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
