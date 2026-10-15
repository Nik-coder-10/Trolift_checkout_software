/**
 * Production configuration verification.
 *
 * Central place that answers: "is this deployment safe to serve real
 * money and real tax documents?" Every check reports the VARIABLE
 * NAME and a symptom — never a value, never a secret.
 *
 * Severity model:
 * - `critical` — in production, readiness FAILS (503). Serving orders
 *   without these settings produces broken payments or half-headed
 *   invoices, which is worse than being down.
 * - `warning`  — surfaced but not fatal: the system has a documented,
 *   tested fallback (e.g. no home state → IGST everywhere).
 *
 * Outside production (dev/test/staging) nothing here can fail
 * readiness — it only reports — so local development never fights
 * production-only configuration.
 */

import { isStateCode } from "@/lib/tax/india";
import { isValidGstin } from "@/lib/validations/common";
import { hasUpstashConfig, isExplicitMemory } from "@/lib/rate-limit/index";

/**
 * UPI VPA shape (local copy — lib/payments/upi.ts owns the canonical
 * `isValidUpiVpa`, but that module is server-only and this validator
 * must stay importable from unit tests without the server runtime).
 */
function isUpiVpaShape(value: string): boolean {
  return /^[A-Za-z0-9._-]{2,}@[A-Za-z0-9._-]{2,}$/.test(value.trim());
}

export type ConfigSeverity = "critical" | "warning";

export interface ConfigCheck {
  /** Environment variable (or group) this check is about. */
  id: string;
  label: string;
  severity: ConfigSeverity;
  ok: boolean;
  /** Human-readable symptom. Never contains a value. */
  detail: string;
}

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === "production";
}

function present(name: string): boolean {
  return (process.env[name] ?? "").trim() !== "";
}

/** IANA zone validity probe (throws RangeError on garbage names). */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify every environment setting a production deployment depends on.
 * Ordered worst-first so operators read the blockers immediately.
 */
export function verifyProductionConfig(): ConfigCheck[] {
  const checks: ConfigCheck[] = [];
  const production = isProductionEnv();

  // ── Supabase (public URL/anon key + service role) ─────────────────
  const supabaseReady =
    present("NEXT_PUBLIC_SUPABASE_URL") &&
    present("NEXT_PUBLIC_SUPABASE_ANON_KEY") &&
    present("SUPABASE_SERVICE_ROLE_KEY");
  checks.push({
    id: "supabase",
    label: "Supabase project credentials",
    severity: "critical",
    ok: supabaseReady,
    detail: supabaseReady
      ? "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are set."
      : "One or more of NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY is missing — no data plane.",
  });

  // ── Payment identity (UPI) ────────────────────────────────────────
  // A malformed VPA prints a QR that no UPI app can pay to — the same
  // harm as a missing one — so shape is part of the critical check.
  const upiRaw = (process.env.OWNER_UPI_ID ?? "").trim();
  const upiOk = upiRaw !== "" && isUpiVpaShape(upiRaw);
  checks.push({
    id: "upi",
    label: "Owner UPI id (payment instructions)",
    severity: "critical",
    ok: upiOk,
    detail:
      upiRaw === ""
        ? "OWNER_UPI_ID is missing — checkout would show payment instructions with no payee. Refusing to be ready in production."
        : !isUpiVpaShape(upiRaw)
          ? "OWNER_UPI_ID is set but is not a valid UPI VPA (expected user@bank) — QR/deep-links would fail. Fix the value; it is never echoed."
          : "OWNER_UPI_ID is set and has a valid VPA shape; payment instructions and QR generation work.",
  });

  // ── Invoice / business identity ───────────────────────────────────
  const businessName = present("TROLIFT_BUSINESS_NAME");
  const businessAddress = present("TROLIFT_BUSINESS_ADDRESS");
  checks.push({
    id: "invoice-identity",
    label: "Seller block (tax invoice identity)",
    severity: "critical",
    ok: businessName && businessAddress,
    detail:
      businessName && businessAddress
        ? "TROLIFT_BUSINESS_NAME and TROLIFT_BUSINESS_ADDRESS are set."
        : "TROLIFT_BUSINESS_NAME / TROLIFT_BUSINESS_ADDRESS missing — every invoice download would 500. Fix before taking payments.",
  });

  // Display-only on the invoice, but a malformed GSTIN printed on a
  // tax document is worse than none — flag the shape, never the value.
  const gstin = (process.env.TROLIFT_BUSINESS_GSTIN ?? "").trim().toUpperCase();
  const gstinOk = gstin !== "" && isValidGstin(gstin);
  checks.push({
    id: "gstin",
    label: "Seller GSTIN",
    severity: "warning",
    ok: gstinOk,
    detail:
      gstin === ""
        ? "TROLIFT_BUSINESS_GSTIN is empty — invoices will carry no seller GSTIN. Confirm this is intended before GST-registered customers order."
        : !isValidGstin(gstin)
          ? "TROLIFT_BUSINESS_GSTIN is set but fails GSTIN format validation — every invoice would print a malformed seller GSTIN. Fix or clear it; the value is never echoed."
          : "TROLIFT_BUSINESS_GSTIN is set and passes GSTIN format validation (display-only on invoices, never government-verified).",
  });

  // An invalid prefix throws inside getInvoicePrefix() at invoice-issue
  // time (every paid-order download 500s). Fail readiness instead.
  const prefixRaw = (process.env.TROLIFT_INVOICE_PREFIX ?? "INV").trim().toUpperCase();
  const prefixOk = /^[A-Z]{2,10}$/.test(prefixRaw);
  checks.push({
    id: "invoice-prefix",
    label: "Invoice number prefix",
    severity: "critical",
    ok: prefixOk,
    detail: prefixOk
      ? "TROLIFT_INVOICE_PREFIX is a valid invoice prefix (defaults to INV when unset)."
      : "TROLIFT_INVOICE_PREFIX must be 2–10 uppercase letters — invoice issuance would throw for every paid order. Fix or unset it (default INV).",
  });

  // ── Tax configuration (never silently misleading) ─────────────────
  const rawState = (process.env.TROLIFT_STATE_CODE ?? "").trim();
  let stateOk: boolean;
  let stateDetail: string;
  if (rawState === "") {
    stateOk = false;
    stateDetail =
      "TROLIFT_STATE_CODE is unset — every GST order computes IGST (documented fallback). Set the 2-digit home state code once Trolift confirms it.";
  } else if (isStateCode(rawState)) {
    stateOk = true;
    stateDetail = "TROLIFT_STATE_CODE is a valid GST state code.";
  } else {
    stateOk = false;
    stateDetail =
      "TROLIFT_STATE_CODE is set but is not a valid 2-digit GST state code — treated as unset (IGST fallback). Fix or clear it; a typo must never pick the wrong tax split.";
  }
  checks.push({
    id: "state-code",
    label: "Business GST state code",
    severity: "warning",
    ok: stateOk,
    detail: stateDetail,
  });

  // ── Timezone ──────────────────────────────────────────────────────
  const tz = (process.env.BUSINESS_TIMEZONE ?? "").trim();
  const tzOk = tz === "" || isValidTimezone(tz);
  checks.push({
    id: "timezone",
    label: "Business timezone",
    severity: "warning",
    ok: tzOk,
    detail: tzOk
      ? tz === ""
        ? "BUSINESS_TIMEZONE unset — defaults to Asia/Kolkata."
        : "BUSINESS_TIMEZONE is a valid IANA timezone."
      : "BUSINESS_TIMEZONE is not a valid IANA timezone — dashboards would fall back to UTC day boundaries. Fix the name.",
  });

  // ── Shared rate-limit backend ─────────────────────────────────────
  // In production without a shared store, budgets are enforced
  // per-instance from in-process memory (see lib/rate-limit): bounded,
  // but not shared across instances, so a burst can still fan out. That
  // is a degradation to flag loudly — not a fatal misconfiguration, since
  // ordering and payment stay available.
  if (production) {
    const explicitMemory = isExplicitMemory();
    const upstash = hasUpstashConfig();
    const rlOk = upstash || explicitMemory;
    checks.push({
      id: "rate-limit",
      label: "Shared rate-limit backend",
      severity: "warning",
      ok: rlOk,
      detail: rlOk
        ? explicitMemory
          ? "RATE_LIMIT_BACKEND=memory explicitly chosen — budgets are per-instance only (single-instance deploys only)."
          : "Upstash shared store configured; all instances enforce one budget."
        : "No UPSTASH_REDIS_REST_URL/TOKEN and no explicit RATE_LIMIT_BACKEND — budgets fall back to per-instance memory (degraded, not shared). Configure Upstash for one global budget; set RATE_LIMIT_BACKEND=memory to acknowledge single-instance.",
    });
  }

  return checks;
}

/** Critical failures only — what makes readiness itself fail. */
export function criticalConfigFailures(checks: ConfigCheck[]): ConfigCheck[] {
  return checks.filter((c) => c.severity === "critical" && !c.ok);
}

/** Warning-level misses — reported by /api/ready, never fatal. */
export function configWarnings(checks: ConfigCheck[]): ConfigCheck[] {
  return checks.filter((c) => c.severity === "warning" && !c.ok);
}
