import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // A URL so the Prisma client can be constructed in tests. No connection is
    // made — the write guard throws before any query reaches the database.
    env: {
      DATABASE_URL: "postgresql://user:password@localhost:5432/fini?sslmode=disable",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
