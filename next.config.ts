import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** sharp is a native addon, used to normalise images before OCR. */
  serverExternalPackages: ["sharp"],

  /**
   * Emits .next/standalone with only the files the server actually needs, so the
   * container ships without node_modules. Cuts the image from roughly 1.2GB to
   * around 250MB, which matters on hosts that meter build minutes and image size.
   */
  output: "standalone",
};

export default nextConfig;
