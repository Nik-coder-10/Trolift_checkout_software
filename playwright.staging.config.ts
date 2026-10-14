import { defineConfig, devices } from "@playwright/test";

/**
 * Staging browser E2E (live backend, disposable).
 *
 * Runs the REAL application against a REAL PostgreSQL-backed Supabase
 * staging stack and exercises full customer + admin + authorization +
 * failure journeys in actual browsers. This complements (never
 * replaces) the hermetic offline suite in playwright.config.ts.
 *
 * Safety (fail fast, never production):
 * - Requires STAGING_E2E_ENABLED=1, otherwise the config throws.
 * - STAGING_BASE_URL must be a loopback URL (127.0.0.1/localhost).
 *   Anything else throws — staging credentials must never point at a
 *   real deployment from here.
 * - Supabase URL must also be loopback. Keys come from the environment
 *   only (STAGING_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY) and are
 *   never committed; test identities live in e2e/staging/.auth/
 *   (gitignored) and use synthetic STGE2E data exclusively.
 * - Real UPI transfers are impossible: payment is a simulated UTR
 *   claim verified by the test admin identity.
 *
 * Usage:
 *   STAGING_E2E_ENABLED=1 STAGING_SUPABASE_URL=... \\
 *     STAGING_SUPABASE_ANON_KEY=... STAGING_SERVICE_ROLE_KEY=... \\
 *     npm run test:e2e:staging
 */

const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function required(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value === "") {
    throw new Error(`[staging-e2e] Missing required env var ${name}. Refusing to run.`);
  }
  return value;
}

if (process.env.STAGING_E2E_ENABLED !== "1") {
  throw new Error(
    "[staging-e2e] STAGING_E2E_ENABLED is not 1. Refusing to run.",
  );
}

const baseURL = process.env.STAGING_BASE_URL ?? "http://127.0.0.1:3100";
if (!LOOPBACK.test(baseURL)) {
  throw new Error(
    `[staging-e2e] STAGING_BASE_URL must be loopback, got ${baseURL}. Refusing to run (production guard).`,
  );
}

const supabaseUrl = required("STAGING_SUPABASE_URL");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(supabaseUrl)) {
  throw new Error(
    "[staging-e2e] STAGING_SUPABASE_URL must be loopback. Refusing to run (production guard).",
  );
}
required("STAGING_SUPABASE_ANON_KEY");
required("STAGING_SERVICE_ROLE_KEY");

export default defineConfig({
  testDir: "./e2e/staging",
  globalSetup: "./e2e/staging/setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // No retries: every attempt mutates backend state (orders advance,
  // tokens rotate), so a retry would run against a consumed order and
  // fail misleadingly. A failed run is followed by a fresh full run:
  // 1-customer mints a new order and the sweep below removes stale
  // STGE2E records.
  retries: 0,
  timeout: 180_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
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
    // Production build + start: precompiled (no cold-compile hydration
    // races) and the faithful staging mirror — no HMR, no dev overlays.
    command: "npm run test:e2e:staging:serve",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 420_000,
    env: {
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.STAGING_SUPABASE_ANON_KEY ?? "",
      SUPABASE_SERVICE_ROLE_KEY: process.env.STAGING_SERVICE_ROLE_KEY ?? "",
      // Seller block for generated tax invoices: getBusinessDetails()
      // requires a name + address and fails the route with a 500 when
      // they are missing, so the invoice journeys need them configured.
      // Synthetic staging values — never the real business identity.
      TROLIFT_BUSINESS_NAME: "STGE2E Staging Traders",
      TROLIFT_BUSINESS_ADDRESS: "1 Test Estate, Mumbai, Maharashtra 400001",
      TROLIFT_BUSINESS_PHONE: "9000000000",
      TROLIFT_BUSINESS_EMAIL: "staging@example.test",
      TROLIFT_BUSINESS_GSTIN: "27ABCDE1234F1Z0",
      // Letters only (2–10): digits make getInvoicePrefix() throw.
      TROLIFT_INVOICE_PREFIX: "STG",
      // Mumbai (27) matches the journey's billing state, so GST orders
      // resolve to intra-state CGST+SGST rather than a default IGST.
      TROLIFT_STATE_CODE: "27",
      // Disposable single-instance staging: explicitly in-process
      // counters (logged by the app, never silent). Real deployments
      // must use RATE_LIMIT_BACKEND=upstash instead.
      RATE_LIMIT_BACKEND: "memory",
      // Generous budgets for a disposable serial run: journey specs
      // assert workflows, not quota enforcement (covered by unit
      // tests). Keeps shared-IP buckets from flaking the suite.
      RATE_LIMIT_WINDOW_MS: "60000",
      RATE_LIMIT_ORDERS_PER_MIN: "1000",
      RATE_LIMIT_CLAIM_PER_MIN: "1000",
      RATE_LIMIT_SESSION_PER_MIN: "1000",
      RATE_LIMIT_RECOVER_PER_MIN: "1000",
      RATE_LIMIT_DELIVERY_PER_MIN: "1000",
      RATE_LIMIT_INVOICE_PER_MIN: "1000",
      RATE_LIMIT_ADMIN_PER_MIN: "1000",
      RATE_LIMIT_AUTH_PER_MIN: "1000",
      RATE_LIMIT_READY_PER_MIN: "1000",
    },
  },
});
