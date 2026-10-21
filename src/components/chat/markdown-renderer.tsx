"use client";

import React, { memo } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { FileText, ExternalLink } from "lucide-react";
import type { SourceReference } from "@/types/chat";
import { cn } from "@/lib/utils";

export interface MarkdownRendererProps {
  content: string;
  sources?: SourceReference[];
  isStreaming?: boolean;
  className?: string;
}

/**
 * Validates that an href is safe to navigate to, blocking javascript:, vbscript:,
 * and data: URIs from executing scripts.
 */
function isSafeUrl(url?: string): boolean {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  if (
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("vbscript:")
  ) {
    return false;
  }
  return true;
}

/**
 * Transforms [Source N] tokens (e.g. "[Source 1]", "[Source 1, Source 2]", "[Source 1, 2]")
 * into markdown links targeting #citation-N so they render as interactive citation pills.
 */
function preprocessCitations(text: string): string {
  if (!text) return "";

  return text.replace(
    /\[((?:Source\s*\d+(?:\s*,\s*(?:Source\s*)?\d+)*))\]/gi,
    (_match, inner: string) => {
      const parts = inner.split(",").map((p) => p.trim());
      return parts
        .map((part) => {
          const matchNum = part.match(/\d+/);
          if (!matchNum) return part;
          const num = matchNum[0];
          return `[Source ${num}](#citation-${num})`;
        })
        .join(", ");
    }
  );
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  sources = [],
  isStreaming = false,
  className,
}: MarkdownRendererProps) {
  const processedContent = React.useMemo(() => {
    return preprocessCitations(content);
  }, [content]);

  const components: Components = {
    // Headings
    h1: ({ children }) => (
      <h1 className="mt-4 mb-2 text-base font-bold tracking-tight text-foreground first:mt-0 sm:text-lg">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-3.5 mb-1.5 text-sm font-semibold tracking-tight text-foreground first:mt-0 sm:text-base">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-3 mb-1 text-sm font-semibold text-foreground first:mt-0">
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-2.5 mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
        {children}
      </h4>
    ),

    // Paragraphs
    p: ({ children }) => (
      <p className="my-2 text-sm leading-relaxed text-foreground/90 first:mt-0 last:mb-0">
        {children}
      </p>
    ),

    // Lists
    ul: ({ children }) => (
      <ul className="my-2 ms-5 list-disc space-y-1 text-sm text-foreground/90 marker:text-primary">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 ms-5 list-decimal space-y-1 text-sm text-foreground/90 marker:font-medium marker:text-primary">
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className="text-sm leading-relaxed ps-0.5">{children}</li>
    ),

    // Strong & Emphasis
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }) => (
      <em className="italic text-foreground/90">{children}</em>
    ),

    // Blockquote (ideal for medical warnings, disclaimers, or notes)
    blockquote: ({ children }) => (
      <blockquote className="my-3 rounded-e-lg border-s-3 border-primary/60 bg-primary/5 py-1.5 ps-3.5 text-sm italic text-foreground/90">
        {children}
      </blockquote>
    ),

    // Horizontal Rule
    hr: () => <hr className="my-4 border-t border-border/70" />,

    // Tables (with horizontal scroll on mobile)
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-border shadow-xs">
        <table className="w-full border-collapse text-xs sm:text-sm">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="border-b border-border bg-muted/80 text-foreground font-semibold">
        {children}
      </thead>
    ),
    tbody: ({ children }) => (
      <tbody className="divide-y divide-border/40 bg-card/50">
        {children}
      </tbody>
    ),
    tr: ({ children }) => (
      <tr className="transition-colors hover:bg-muted/40 even:bg-muted/15">
        {children}
      </tr>
    ),
    th: ({ children }) => (
      <th className="px-3 py-2 text-start font-semibold text-foreground text-xs uppercase tracking-wider">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-2 text-foreground/90 align-top">
        {children}
      </td>
    ),

    // Code & Code Blocks
    code: ({ children, className: codeClass }) => {
      const isMultiLine = String(children).includes("\n");
      if (isMultiLine) {
        return (
          <div className="my-2.5 overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-xs text-foreground">
            <code>{children}</code>
          </div>
        );
      }
      return (
        <code
          className={cn(
            "rounded border border-border/50 bg-muted/80 px-1.5 py-0.5 font-mono text-xs text-foreground",
            codeClass
          )}
        >
          {children}
        </code>
      );
    },

    // Links & Citations
    a: ({ href, children }) => {
      if (!isSafeUrl(href)) {
        return <span>{children}</span>;
      }

      // Check if this link is a citation link generated by preprocessCitations
      if (href?.startsWith("#citation-")) {
        const sourceIndex = parseInt(href.replace("#citation-", ""), 10);
        const source = !isNaN(sourceIndex) && sourceIndex > 0 ? sources[sourceIndex - 1] : undefined;

        if (source) {
          const tooltip = `${source.documentTitle}${source.section ? ` · ${source.section}` : ""}`;
          return (
            <Link
              href={`/documents/${source.documentId}`}
              className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.2 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20 hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mx-0.5 align-baseline"
              title={tooltip}
            >
              <FileText className="size-2.5" aria-hidden="true" />
              <span>Source {sourceIndex}</span>
            </Link>
          );
        }

        // Fallback badge if sources are not yet resolved during initial streaming
        return (
          <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.2 text-[11px] font-medium text-muted-foreground mx-0.5 align-baseline">
            <span>Source {sourceIndex}</span>
          </span>
        );
      }

      // Standard links
      const isExternal = href?.startsWith("http://") || href?.startsWith("https://");

      if (isExternal) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
          >
            <span>{children}</span>
            <ExternalLink className="size-3 inline-block" aria-hidden="true" />
          </a>
        );
      }

      return (
        <Link
          href={href || "#"}
          className="font-medium text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
        >
          {children}
        </Link>
      );
    },
  };

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none text-sm break-words",
        isStreaming && "animate-in fade-in-50 duration-150",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processedContent}
      </ReactMarkdown>
    </div>
  );
});
