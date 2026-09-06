import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Left out of the bundle rather than compiled into it.
   *
   * `sharp` is a native addon. `pdf-parse` wraps pdf.js, which touches browser globals
   * — DOMMatrix among them — while its module is being evaluated. Bundled, that code
   * runs in Node and throws `ReferenceError: DOMMatrix is not defined` before any
   * function is called. Loaded from node_modules it resolves its Node build instead.
   */
  serverExternalPackages: ["sharp", "pdf-parse"],

  /**
   * Emits .next/standalone with only the files the server actually needs, so the
   * container ships without node_modules. Cuts the image from roughly 1.2GB to
   * around 250MB, which matters on hosts that meter build minutes and image size.
   */
  output: "standalone",
};

export default nextConfig;
