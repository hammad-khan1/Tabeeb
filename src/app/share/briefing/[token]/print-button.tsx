"use client";

import { Printer } from "lucide-react";

export function BriefingPrintButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={
        className ||
        "inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition print:hidden cursor-pointer shadow-xs"
      }
      id="print-share-btn"
      aria-label="Print or save as PDF"
    >
      <Printer className="size-4" aria-hidden="true" />
      <span>Print / Save PDF</span>
    </button>
  );
}
