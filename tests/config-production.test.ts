import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configWarnings,
  criticalConfigFailures,
  isValidTimezone,
  verifyProductionConfig,
} from "@/lib/config/production";

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OWNER_UPI_ID",
  "TROLIFT_BUSINESS_NAME",
  "TROLIFT_BUSINESS_ADDRESS",
  "TROLIFT_BUSINESS_GSTIN",
  "TROLIFT_STATE_CODE",
  "BUSINESS_TIMEZONE",
  "RATE_LIMIT_BACKEND",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];

const ORIGINALS = new Map<string, string | undefined>();
for (const key of KEYS) ORIGINALS.set(key, process.env[key]);

function setEnv(values: Record<string, string>): void {
  // Assigning undefined to process.env stores the STRING "undefined";
  // delete instead so `present()` sees a genuinely absent variable.
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

function checkById(id: string) {
  const check = verifyProductionConfig().find((c) => c.id === id);
  if (!check) throw new Error(`missing check ${id}`);
  return check;
}

afterEach(() => {
  for (const [key, value] of ORIGINALS) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllEnvs();
});

describe("verifyProductionConfig", () => {
  it("fully configured environment passes every critical check", () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      OWNER_UPI_ID: "owner@upi",
      TROLIFT_BUSINESS_NAME: "Trolift Solutions",
      TROLIFT_BUSINESS_ADDRESS: "Mumbai",
      TROLIFT_STATE_CODE: "27",
      BUSINESS_TIMEZONE: "Asia/Kolkata",
      RATE_LIMIT_BACKEND: "memory",
    });
    expect(criticalConfigFailures(verifyProductionConfig())).toEqual([]);
  });

  it("flags each missing critical setting by name", () => {
    setEnv({});
    const failures = criticalConfigFailures(verifyProductionConfig());
    const ids = failures.map((f) => f.id);
    expect(ids).toContain("supabase");
    expect(ids).toContain("upi");
    expect(ids).toContain("invoice-identity");
    // Warnings are not critical failures.
    expect(ids).not.toContain("state-code");
    expect(ids).not.toContain("gstin");
    expect(ids).not.toContain("timezone");
  });

  it("warns (not fails) when the home GST state is unset or invalid", () => {
    setEnv({});
    const unset = checkById("state-code");
    expect(unset.ok).toBe(false);
    expect(unset.severity).toBe("warning");
    expect(unset.detail).toContain("IGST");

    setEnv({ TROLIFT_STATE_CODE: "99" });
    const invalid = checkById("state-code");
    expect(invalid.ok).toBe(false);
    expect(invalid.detail).toContain("not a valid");

    setEnv({ TROLIFT_STATE_CODE: "27" });
    expect(checkById("state-code").ok).toBe(true);
  });

  it("never echoes environment values, only names", () => {
    setEnv({
      OWNER_UPI_ID: "super-secret-vpa@bank",
      TROLIFT_BUSINESS_GSTIN: "27ABCDE1234F1Z0",
      UPSTASH_REDIS_REST_TOKEN: "secret-token",
    });
    const serialized = JSON.stringify(verifyProductionConfig());
    expect(serialized).not.toContain("super-secret-vpa@bank");
    expect(serialized).not.toContain("27ABCDE1234F1Z0");
    expect(serialized).not.toContain("secret-token");
  });

  it("treats an invalid timezone as a warning naming the variable", () => {
    setEnv({ BUSINESS_TIMEZONE: "Mars/Olympus" });
    const tz = checkById("timezone");
    expect(tz.ok).toBe(false);
    expect(tz.severity).toBe("warning");
  });

  it("production without a shared rate-limit store is a critical failure", () => {
    vi.stubEnv("NODE_ENV", "production");
    setEnv({});
    const rl = checkById("rate-limit");
    expect(rl.severity).toBe("critical");
    expect(rl.ok).toBe(false);

    // Explicit memory is an acknowledged single-instance choice.
    setEnv({ RATE_LIMIT_BACKEND: "memory" });
    expect(checkById("rate-limit").ok).toBe(true);

    // A configured Upstash store satisfies the check.
    setEnv({
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "token",
    });
    expect(checkById("rate-limit").ok).toBe(true);
  });

  it("rate-limit check is only emitted in production (never blocks dev)", () => {
    setEnv({});
    // vitest runs NODE_ENV=test: the check is not emitted at all, so a
    // bare dev environment can never trip it.
    expect(verifyProductionConfig().find((c) => c.id === "rate-limit")).toBeUndefined();
  });

  it("fails critical on a malformed UPI id (broken QR is as bad as missing)", () => {
    setEnv({ OWNER_UPI_ID: "not-a-vpa" });
    const upi = checkById("upi");
    expect(upi.severity).toBe("critical");
    expect(upi.ok).toBe(false);
    expect(upi.detail).toContain("VPA");

    setEnv({ OWNER_UPI_ID: "  trolift@upi  " });
    expect(checkById("upi").ok).toBe(true);
  });

  it("warns on a malformed seller GSTIN (never echoes the value)", () => {
    setEnv({ TROLIFT_BUSINESS_GSTIN: "BOGUS-GSTIN" });
    const gstin = checkById("gstin");
    expect(gstin.severity).toBe("warning");
    expect(gstin.ok).toBe(false);
    expect(JSON.stringify(gstin)).not.toContain("BOGUS-GSTIN");

    setEnv({ TROLIFT_BUSINESS_GSTIN: "27ABCDE1234F1Z0" });
    expect(checkById("gstin").ok).toBe(true);
  });

  it("fails critical on a bad invoice prefix (issuance would 500)", () => {
    setEnv({});
    // Unset defaults to INV — valid.
    expect(checkById("invoice-prefix").ok).toBe(true);

    setEnv({ TROLIFT_INVOICE_PREFIX: "nope!" });
    const prefix = checkById("invoice-prefix");
    expect(prefix.severity).toBe("critical");
    expect(prefix.ok).toBe(false);
  });

  it("exposes warning ids separately from critical failures", () => {
    setEnv({});
    const warnings = configWarnings(verifyProductionConfig()).map((c) => c.id);
    expect(warnings).toContain("gstin");
    expect(warnings).toContain("state-code");
    expect(warnings).not.toContain("upi");
    expect(warnings).not.toContain("invoice-identity");
  });
});

describe("isValidTimezone", () => {
  it("accepts real IANA zones and rejects garbage", () => {
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Not/AZone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});
