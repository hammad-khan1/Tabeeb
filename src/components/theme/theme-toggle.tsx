"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

export interface ThemeToggleProps {
  className?: string;
}

/**
 * Perfectly circular Light/Dark theme toggle button with a dark charcoal background,
 * subtle soft light-blue circular border, centered Moon/Sun icons, and smooth transitions.
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  // Avoid layout shift & hydration mismatch
  if (!mounted) {
    return (
      <div
        className="size-9 shrink-0 rounded-full border border-sky-400/35 bg-[#181d24] shadow-xs"
        aria-hidden="true"
      />
    );
  }

  const isDark = resolvedTheme === "dark";

  const handleToggle = () => {
    setTheme(isDark ? "light" : "dark");
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={`group relative flex size-9 shrink-0 items-center justify-center rounded-full border border-sky-400/35 bg-[#181d24] text-foreground shadow-xs transition-all duration-300 hover:border-sky-400/70 hover:shadow-[0_0_12px_rgba(56,189,248,0.3)] hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/50 ${
        className ?? ""
      }`}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      <div className="relative size-4.5">
        <Sun
          className={`absolute inset-0 size-4.5 text-amber-300 transition-all duration-300 ${
            isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-45 scale-0 opacity-0"
          }`}
          strokeWidth={2}
          aria-hidden="true"
        />
        <Moon
          className={`absolute inset-0 size-4.5 text-sky-200 transition-all duration-300 ${
            isDark ? "rotate-45 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
          }`}
          strokeWidth={2}
          aria-hidden="true"
        />
      </div>
      <span className="sr-only">
        {isDark ? "Switch to light theme" : "Switch to dark theme"}
      </span>
    </button>
  );
}
