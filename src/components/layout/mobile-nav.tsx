"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
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
  Menu,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
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

export function MobileNav() {
  const { t } = useLocale();
  const pathname = usePathname()

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" className="lg:hidden" />
        }
      >
        <Menu className="size-5" />
        <span className="sr-only">Open navigation menu</span>
      </SheetTrigger>

      <SheetContent side="left" className="w-72 p-0">
        {/* Branding */}
        <SheetHeader className="border-b border-border px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Activity className="size-4.5" />
            </div>
            <SheetTitle className="text-lg font-semibold tracking-tight">
              Tabeeb
            </SheetTitle>
          </div>
        </SheetHeader>

        {/* Navigation */}
        <ScrollArea className="flex-1 py-2">
          <nav className="flex flex-col gap-0.5 px-3">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href))
              const Icon = item.icon

              return (
                <SheetClose key={item.href} render={
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    )}
                  />
                }>
                  <Icon className="size-4 shrink-0" />
                  {t(item.key)}
                </SheetClose>
              )
            })}
          </nav>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
