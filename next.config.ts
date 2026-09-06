import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** sharp is a native addon, used to normalise images before OCR. */
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
