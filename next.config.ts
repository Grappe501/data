import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tracingRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: tracingRoot,
  serverExternalPackages: ["xlsx", "@prisma/client"],
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
