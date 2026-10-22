// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThemeToggle } from "./theme-toggle";

const mockSetTheme = vi.fn();
let mockResolvedTheme = "light";

vi.mock("next-themes", () => ({
  useTheme: () => ({
    resolvedTheme: mockResolvedTheme,
    theme: mockResolvedTheme,
    setTheme: mockSetTheme,
  }),
}));

describe("ThemeToggle Component", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockResolvedTheme = "light";
    mockSetTheme.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders a circular toggle button with charcoal background and soft light-blue border", () => {
    act(() => {
      root.render(<ThemeToggle />);
    });

    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.className).toContain("rounded-full");
    expect(button?.className).toContain("bg-[#181d24]");
    expect(button?.className).toContain("border-sky-400/35");
  });

  it("has accessible label for switching to dark theme when in light mode", () => {
    mockResolvedTheme = "light";
    act(() => {
      root.render(<ThemeToggle />);
    });

    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Switch to dark theme");
    expect(button?.getAttribute("title")).toBe("Switch to dark theme");
  });

  it("calls setTheme('dark') when clicked in light mode", () => {
    mockResolvedTheme = "light";
    act(() => {
      root.render(<ThemeToggle />);
    });

    const button = container.querySelector("button");
    act(() => {
      button?.click();
    });

    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("has accessible label and calls setTheme('light') when in dark mode", () => {
    mockResolvedTheme = "dark";
    act(() => {
      root.render(<ThemeToggle />);
    });

    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("Switch to light theme");
    expect(button?.getAttribute("title")).toBe("Switch to light theme");

    act(() => {
      button?.click();
    });

    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });
});
