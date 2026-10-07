import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's own `@/*` path, so a test can import a module the same way the
    // app does instead of stepping back through relative paths.
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    // Local tool state, including other checkouts of this repo.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
