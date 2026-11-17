import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Static export so the app can be bundled into the Android APK and run fully offline.
   * Note: PPR (cacheComponents / partialPrefetching) is unsupported in export mode. */
  output: "export",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
