import { defineConfig, devices } from "@playwright/test";

/**
 * Browser E2E layer (complements the Vitest unit/integration suite).
 *
 * Runs against the real Next.js app with no backend credentials, so
 * the catalogue's offline fallback serves deterministic dev data —
 * every spec below must pass with or without Supabase linked. Flows
 * that need a live database (order placement, payment, admin) are
 * proven at the HTTP layer in tests/journey.test.ts instead.
 */
export default defineConfig({
  testDir: "./e2e",
  // e2e/staging is the live-backend suite owned by
  // playwright.staging.config.ts (`npm run test:e2e:staging`). It needs
  // credentials and a running Supabase stack, so it must never be swept
  // into this hermetic, credential-free project.
  testIgnore: ["staging/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Force the offline catalogue fallback so specs are hermetic:
      // no backend, no flakes, same data on every machine.
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    },
  },
});
