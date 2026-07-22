import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Separate from vitest.config.ts on purpose: these tests hit a real local
 * Supabase instance over the network (no DOM needed, so plain "node" env)
 * and must never run as part of `npm run test` when no such instance is
 * up. Only `npm run test:integration`, wired into CI's `database` job
 * after `supabase db reset`, runs this config.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
