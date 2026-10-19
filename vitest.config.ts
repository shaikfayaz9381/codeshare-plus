import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));

const alias = {
  "@": root,
  // `server-only` throws outside a React Server Component context; the stub
  // lets integration tests import server modules directly.
  "server-only": path.join(root, "tests/stubs/server-only.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["tests/setup/unit-env.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/setup/global-setup.ts"],
          // One real PostgreSQL instance and one filesystem storage root are
          // shared by all integration files: run them serially.
          fileParallelism: false,
          pool: "forks",
          testTimeout: 60_000,
          hookTimeout: 240_000,
        },
      },
    ],
  },
});
