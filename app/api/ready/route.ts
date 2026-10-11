import { fail, ok } from "@/lib/api/response";
import { withErrorHandling } from "@/lib/api/handler";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { logError } from "@/lib/observability/logger";
import {
  configWarnings,
  criticalConfigFailures,
  verifyProductionConfig,
} from "@/lib/config/production";

/**
 * GET /api/ready — orchestrator readiness probe.
 *
 * Abuse-proofing (the probe must never become a DB hammer):
 * - Dedicated "ready" rate-limit bucket per client IP.
 * - 10-second in-process result cache: a poll storm serves one cached
 *   verdict instead of N database round-trips. (Per-instance caching
 *   is sufficient here — readiness is best-effort by nature and the
 *   window is tiny; the DB still sees at most ~6 queries/min/instance.)
 * - Bounded query cost: single-row `.limit(1)` probe with a 3-second
 *   race timeout; slowness reports unready, never hangs the probe.
 * - Safe response: `{ checks: { database, config } }` only — no
 *   credentials, schema, hostnames, error internals, or env values.
 *
 * In production, CRITICAL configuration failures (missing/malformed
 * UPI id, missing invoice identity, bad invoice prefix, missing shared
 * rate-limit store) also fail readiness: serving money traffic without
 * them produces broken payments or un-downloadable invoices, which is
 * worse than a 503. WARNING-level items (seller GSTIN shape, home GST
 * state, timezone) are listed under `checks.config.warnings` but never
 * fail the probe. Outside production config is reported but never fatal.
 */
export const runtime = "nodejs";

const CACHE_TTL_MS = 10_000;
const DB_TIMEOUT_MS = 3_000;

interface CachedVerdict {
  at: number;
  status: number;
  body: unknown;
}

let cache: CachedVerdict | null = null;

/** Test/ops hook. */
export function resetReadyCache(): void {
  cache = null;
}

async function probeDatabase(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const query = admin.from("orders").select("id").limit(1);
    const result = (await Promise.race([
      query,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("ready db timeout")), DB_TIMEOUT_MS),
      ),
    ])) as unknown as { error: unknown };
    if (result.error) {
      logError("Readiness probe: database query failed.", {
        operation: "readiness",
      });
      return false;
    }
    return true;
  } catch {
    // Timeout, missing credentials, unreachable backend — all unready,
    // all silent about internals.
    return false;
  }
}

export const GET = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("ready", await checkRateLimit(req, "ready"));
  if (denied) return denied;

  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return ok(cache.body as Record<string, unknown>, { status: cache.status });
  }

  const dbOk = await probeDatabase();
  const configChecks = verifyProductionConfig();
  const configFailures = criticalConfigFailures(configChecks);
  // Warnings (GSTIN absent, home state unset/invalid, bad timezone)
  // are surfaced on every probe so operators see them without
  // tripping readiness — previously they were computed but dropped.
  const warnings = configWarnings(configChecks);
  const configOk = configFailures.length === 0;
  const production = process.env.NODE_ENV === "production";
  const ready = dbOk && (!production || configOk);

  // Names + symptoms only — values never leave this process.
  const configSummary = {
    status: configOk ? "ok" : "error",
    ...(configOk
      ? {}
      : { failing: configFailures.map((c) => c.id) }),
    ...(warnings.length > 0
      ? { warnings: warnings.map((c) => c.id) }
      : {}),
  };
  const body = {
    status: ready ? "ready" : "not-ready",
    service: "trolift-platform",
    checks: {
      database: { status: dbOk ? "ok" : "error" },
      config: configSummary,
    },
    time: new Date().toISOString(),
  };
  const status = ready ? 200 : 503;
  cache = { at: now, status, body };
  if (!ready) {
    if (production && !configOk) {
      // Loud, name-only operator signal: which knobs to turn.
      logError("Readiness failing: critical production configuration missing.", {
        operation: "readiness",
        failing: configFailures.map((c) => c.id),
        warnings: warnings.map((c) => c.id),
      });
    }
    return fail("SERVICE_UNAVAILABLE", "Service is not ready.", {
      status: 503,
      details: { checks: body.checks },
    });
  }
  return ok(body);
});
