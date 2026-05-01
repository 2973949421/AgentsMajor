import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: resolve(packageRoot, "../.."),
  experimental: {
    webpackBuildWorker: false
  }
};

export default nextConfig;
