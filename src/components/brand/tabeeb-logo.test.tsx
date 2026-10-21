import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TabeebLogo } from "./tabeeb-logo";

describe("TabeebLogo Component", () => {
  it("renders primary logo with light and dark mode images by default", () => {
    const html = renderToStaticMarkup(<TabeebLogo />);

    expect(html).toContain("tabeeb-logo-primary.png");
    expect(html).toContain("tabeeb-logo-primary-dark.png");
    expect(html).toContain("dark:hidden");
    expect(html).toContain("dark:inline-block");
  });

  it("renders standalone app icon variant", () => {
    const html = renderToStaticMarkup(<TabeebLogo variant="icon" size="md" alt="Tabeeb App Icon" />);

    expect(html).toContain("tabeeb-app-icon.png");
    expect(html).toContain('alt="Tabeeb App Icon"');
    // App icon variant renders a single image (same across light/dark)
    expect(html).not.toContain("dark:hidden");
  });

  it("renders stacked logo variant", () => {
    const html = renderToStaticMarkup(<TabeebLogo variant="stacked" size="lg" />);

    expect(html).toContain("tabeeb-logo-stacked.png");
    expect(html).toContain("tabeeb-logo-stacked-dark.png");
  });

  it("renders a link when href is provided", () => {
    const html = renderToStaticMarkup(<TabeebLogo variant="primary" href="/dashboard" />);

    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("<a ");
  });

  it("respects forced theme mode", () => {
    const lightHtml = renderToStaticMarkup(<TabeebLogo variant="primary" theme="light" />);
    expect(lightHtml).toContain("tabeeb-logo-primary.png");
    expect(lightHtml).not.toContain("tabeeb-logo-primary-dark.png");

    const darkHtml = renderToStaticMarkup(<TabeebLogo variant="primary" theme="dark" />);
    expect(darkHtml).toContain("tabeeb-logo-primary-dark.png");
    expect(darkHtml).not.toContain("tabeeb-logo-primary.png");
  });

  it("applies custom size and dimensions", () => {
    const html = renderToStaticMarkup(<TabeebLogo variant="icon" width={40} height={40} />);

    expect(html).toContain('width="40"');
    expect(html).toContain('height="40"');
  });
});
