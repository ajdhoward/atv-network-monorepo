import { defineConfig } from "vitest/config";

// R3: a review record has to carry a coverage number and name the files at zero,
// so `pnpm coverage` measures the product source rather than whatever the test
// process happened to load. `scripts/` is deliberately out: its tests spawn the
// CLIs with `spawnSync`, and v8 can only see modules loaded in the test process,
// so including them would report every script at 0% whether it is exercised or
// not — the one number a review must not get wrong.
//
// Entry points (`main.ts`, `main.tsx`) stay in on purpose. They are 0% by
// construction, and a review that has to write that down is more honest than a
// config that quietly hides them.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text"],
      include: [
        "apps/admin-cms/src/**/*.{ts,tsx}",
        "apps/tv-client/src/**/*.{ts,js}",
        "packages/ui-shared/src/**/*.ts",
        "services/atv-core/src/**/*.ts",
      ],
      exclude: ["**/*.test.*", "**/*.d.ts"],
    },
  },
});
