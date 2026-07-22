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
      // lib/operations/** (and other server-only modules) start with
      // `import "server-only"` to fail the Next.js webpack build if
      // accidentally bundled into a Client Component. That package's own
      // `exports` map only swaps in its no-op `empty.js` under Next's
      // "react-server" resolution condition — Vitest's plain Node/Vite
      // resolution never sets that condition, so without this alias every
      // integration test importing lib/operations/* throws
      // "This module cannot be imported from a Client Component module"
      // before a single test can even run. Aliasing straight to the
      // package's own empty.js (not a hand-rolled stub) reproduces exactly
      // what Next's server build already does for server-side code.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
