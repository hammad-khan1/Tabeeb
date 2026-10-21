import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "./markdown-renderer";
import type { SourceReference } from "@/types/chat";

describe("MarkdownRenderer Component", () => {
  const dummySources: SourceReference[] = [
    {
      documentId: "doc-1111",
      documentTitle: "Cardiology Prescription",
      documentType: "prescription",
      chunkContent: "Metformin 500mg daily",
      relevanceScore: 0.95,
      section: "Medications",
    },
    {
      documentId: "doc-2222",
      documentTitle: "Complete Blood Count",
      documentType: "lab_report",
      chunkContent: "Hemoglobin 14.2 g/dL",
      relevanceScore: 0.91,
      section: "Hematology",
    },
  ];

  it("renders bold text and headings correctly without raw markdown markers", () => {
    const md = "### Current Medications\n\nYou were prescribed **Metformin 500mg** daily.";
    const html = renderToStaticMarkup(<MarkdownRenderer content={md} sources={dummySources} />);

    expect(html).toContain("<h3");
    expect(html).toContain("Current Medications</h3>");
    expect(html).toContain(">Metformin 500mg</strong>");
    expect(html).not.toContain("###");
    expect(html).not.toContain("**Metformin");
  });

  it("renders unordered lists cleanly", () => {
    const md = "- Amoxicillin 500 mg\n- Paracetamol 500 mg\n- Cetirizine 10 mg";
    const html = renderToStaticMarkup(<MarkdownRenderer content={md} />);

    expect(html).toContain("<ul");
    expect(html).toContain(">Amoxicillin 500 mg</li>");
    expect(html).toContain(">Paracetamol 500 mg</li>");
    expect(html).toContain(">Cetirizine 10 mg</li>");
  });

  it("renders ordered lists properly", () => {
    const md = "1. Take tablet with meals\n2. Drink plenty of water\n3. Follow up in 2 weeks";
    const html = renderToStaticMarkup(<MarkdownRenderer content={md} />);

    expect(html).toContain("<ol");
    expect(html).toContain(">Take tablet with meals</li>");
    expect(html).toContain(">Follow up in 2 weeks</li>");
  });

  it("renders Markdown tables with responsive scrollable container", () => {
    const md = `| Test | Value | Reference Range | Date |
| --- | --- | --- | --- |
| Hemoglobin | 14.2 g/dL | 13.5 - 17.5 | 2026-04-10 |
| WBC | 6.5 x10^3/uL | 4.5 - 11.0 | 2026-04-10 |`;

    const html = renderToStaticMarkup(<MarkdownRenderer content={md} />);

    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain(">Test</th>");
    expect(html).toContain(">Hemoglobin</td>");
    expect(html).toContain(">14.2 g/dL</td>");
    expect(html).toContain("overflow-x-auto");
  });

  it("transforms in-text [Source N] tokens into clickable document links", () => {
    const md = "Your Metformin dose is 500mg daily [Source 1]. Your hemoglobin was normal [Source 2].";
    const html = renderToStaticMarkup(<MarkdownRenderer content={md} sources={dummySources} />);

    expect(html).toContain('href="/documents/doc-1111"');
    expect(html).toContain("Source 1");
    expect(html).toContain('href="/documents/doc-2222"');
    expect(html).toContain("Source 2");
    expect(html).toContain('title="Cardiology Prescription · Medications"');
  });

  it("handles multi-source citations like [Source 1, Source 2]", () => {
    const md = "Reviewed across both visits [Source 1, Source 2].";
    const html = renderToStaticMarkup(<MarkdownRenderer content={md} sources={dummySources} />);

    expect(html).toContain('href="/documents/doc-1111"');
    expect(html).toContain('href="/documents/doc-2222"');
  });

  it("escapes untrusted raw HTML to prevent XSS", () => {
    const md = '<script>alert("xss")</script><img src="x" onerror="evil()" />';
    const html = renderToStaticMarkup(<MarkdownRenderer content={md} />);

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("rejects malicious javascript: URLs", () => {
    const md = "[Click Here](javascript:alert(1))";
    const html = renderToStaticMarkup(<MarkdownRenderer content={md} />);

    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("Click Here");
  });

  it("handles streaming partial markdown gracefully without throwing", () => {
    const partialMd = "**Metformin 500mg";
    const html = renderToStaticMarkup(<MarkdownRenderer content={partialMd} isStreaming={true} />);

    expect(html).toBeDefined();
    expect(html).toContain("Metformin 500mg");
  });

  it("renders blockquotes and code spans properly", () => {
    const md = "> Note: Discontinue if rash occurs.\n\nLab code `CBC-001`.";
    const html = renderToStaticMarkup(<MarkdownRenderer content={md} />);

    expect(html).toContain("<blockquote");
    expect(html).toContain("Note: Discontinue if rash occurs.");
    expect(html).toContain("<code");
    expect(html).toContain("CBC-001");
  });
});
