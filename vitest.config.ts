import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next.js keeps tsconfig.json's "jsx" at "preserve" for its own SWC
  // pipeline; Vitest 4's rolldown/oxc transform otherwise inherits that
  // and refuses to compile JSX, so the runtime is set explicitly here.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    css: false,
  },
});
