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

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/chat", label: "Ask Tabeeb", icon: MessageSquare },
  { href: "/history", label: "History", icon: Clock },
  { href: "/interactions", label: "Interactions", icon: ShieldCheck },
  { href: "/trends", label: "Trends", icon: TrendingUp },
  { href: "/insights", label: "Insights", icon: Lightbulb },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-border lg:bg-sidebar">
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
                {item.label}
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
