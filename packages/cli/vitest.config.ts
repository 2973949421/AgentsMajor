import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@agent-major/core": resolve(__dirname, "../core/src/index.ts"),
      "@agent-major/db": resolve(__dirname, "../db/src/index.ts"),
      "@agent-major/llm": resolve(__dirname, "../llm/src/index.ts"),
      "@agent-major/queue": resolve(__dirname, "../queue/src/index.ts"),
      "@agent-major/shared": resolve(__dirname, "../shared/src/index.ts")
    }
  }
});
