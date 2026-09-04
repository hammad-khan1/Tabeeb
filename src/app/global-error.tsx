"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary: catches errors thrown by the root layout itself, which
 * `error.tsx` cannot. It replaces the whole document, so it renders its own <html>
 * and cannot use the locale provider or any app styling — hence the inline styles
 * and English-only copy.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[UI] root layout error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#fafafa",
          color: "#111",
          padding: "1.5rem",
        }}
      >
        <main style={{ maxWidth: "26rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", margin: "0 0 0.5rem" }}>
            Tabeeb could not start
          </h1>
          <p style={{ color: "#555", lineHeight: 1.6, margin: "0 0 1.25rem" }}>
            Something went wrong loading the app. Your medical records are safe —
            nothing was changed.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "1px solid #d4d4d4",
              background: "#fff",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Try again
          </button>
          {error.digest && (
            <p style={{ marginTop: "1rem", fontSize: "0.75rem", color: "#777" }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
