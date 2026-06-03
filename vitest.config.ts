import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // better-sqlite3 is a native addon; forks avoid worker-thread segfaults
    pool: "forks",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
