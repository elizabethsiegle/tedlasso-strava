import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    coverage: {
      provider: "istanbul",
      include: ["src/domain/**", "src/data/**", "src/app/**"],
      thresholds: { branches: 95, functions: 95, lines: 95, statements: 95 },
    },
  },
});
