import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * onnxruntime-node is a native addon; bundling it breaks the .node binary
   * resolution. sharp is native too and Next externalises it by default, but naming
   * it here keeps the intent explicit.
   */
  serverExternalPackages: ["onnxruntime-node", "sharp"],

  /**
   * The X-ray model is read from disk at runtime rather than imported, so nothing in
   * the module graph points at it and a standalone build would omit it. Tracing it
   * explicitly is what makes `next build` produce a deployable artifact that can
   * still screen an X-ray.
   */
  outputFileTracingIncludes: {
    "/api/documents/**": ["./models/**"],
  },
};

export default nextConfig;
