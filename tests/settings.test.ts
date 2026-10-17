import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  type MockOp,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let authUser: { id: string } | null = { id: "admin-1" };
let adminFlag = true;
let handler: MockResponder = () => {
  throw new Error("unexpected query");
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createMockClient(handler, { authUser }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(handler),
}));

import { GET, PUT } from "@/app/api/admin/settings/route";
import { AppError } from "@/lib/api/errors";
import { getOwnerUpi, isValidUpiVpa } from "@/lib/payments/upi";
import {
  isSettingKey,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
} from "@/lib/settings/keys";
import {
  getEnvDefaults,
  getSetting,
  getSiteSettings,
  saveSiteSettings,
  validateSettingValue,
} from "@/lib/settings/server";

const settingsRows: Array<{ key: string; value: string }> = [];
const writeOps: MockOp[] = [];

beforeEach(() => {
  resetRateLimits();
  authUser = { id: "admin-1" };
  adminFlag = true;
  settingsRows.length = 0;
  writeOps.length = 0;
  handler = (op) => {
    if (op.table === "profiles") {
      return { rows: adminFlag ? [{ is_admin: true }] : [], error: null };
    }
    if (op.table === "site_settings") {
      if (op.updateValues !== undefined || op.filters.some((f) => f.op === "eq")) {
        writeOps.push(op);
        return { rows: [], error: null };
      }
      return { rows: [...settingsRows], error: null };
    }
    throw new Error(`unexpected table ${op.table ?? op.rpc}`);
  };
});

describe("setting definitions", () => {
  it("every definition key is declared exactly once", () => {
    const defined = SETTING_DEFINITIONS.map((d) => d.key);
    expect([...defined].sort()).toEqual([...SETTING_KEYS].sort());
    expect(new Set(defined).size).toBe(defined.length);
    expect(defined.length).toBe(8);
  });

  it("recognises known keys only", () => {
    expect(isSettingKey("upi_id")).toBe(true);
    expect(isSettingKey("nope")).toBe(false);
  });
});

describe("validateSettingValue", () => {
  it("accepts and trims usable values", () => {
    expect(validateSettingValue("upi_id", "  trolift@upi ")).toBe("trolift@upi");
    expect(validateSettingValue("invoice_prefix", " bill")).toBe("BILL");
    expect(validateSettingValue("payment_window_hours", " 48 ")).toBe("48");
    expect(validateSettingValue("quotation_validity_days", "15")).toBe("15");
    expect(validateSettingValue("business_phone", "+919876543210")).toBe(
      "+919876543210",
    );
    expect(validateSettingValue("business_email", "sales@example.com")).toBe(
      "sales@example.com",
    );
    expect(validateSettingValue("default_low_stock_threshold", "0")).toBe("0");
    expect(validateSettingValue("upi_payee_name", "Trolift")).toBe("Trolift");
  });

  it("rejects unusable values so fallbacks kick in", () => {
    expect(validateSettingValue("upi_id", "")).toBeNull();
    expect(validateSettingValue("upi_id", "not-a-vpa")).toBeNull();
    expect(validateSettingValue("invoice_prefix", "I")).toBeNull(); // too short
    expect(validateSettingValue("invoice_prefix", "INV2")).toBeNull(); // digit
    expect(validateSettingValue("invoice_prefix", "TOOLONGPREFIX")).toBeNull();
    expect(validateSettingValue("payment_window_hours", "0")).toBeNull();
    expect(validateSettingValue("payment_window_hours", "72.5")).toBeNull();
    expect(validateSettingValue("quotation_validity_days", "0")).toBeNull();
    expect(validateSettingValue("business_email", "nope")).toBeNull();
    expect(validateSettingValue("default_low_stock_threshold", "-1")).toBeNull();
    expect(validateSettingValue("upi_id", 42)).toBeNull();
  });
});

describe("settings reads (fail open to environment)", () => {
  it("falls back to env when the table errors", async () => {
    handler = (op) => {
      if (op.table === "site_settings") {
        return { rows: [], error: { message: "boom" } };
      }
      throw new Error(`unexpected table ${op.table}`);
    };
    expect(await getSiteSettings()).toEqual({});
    expect(await getSetting("upi_id")).toBeNull();
  });

  it("drops invalid stored rows and keeps valid ones", async () => {
    settingsRows.push(
      { key: "upi_id", value: "override@upi" },
      { key: "upi_id", value: "not-a-vpa" }, // invalid row ignored
      { key: "invoice_prefix", value: "BILL" },
      { key: "invoice_prefix", value: "bad prefix" }, // invalid row ignored
      { key: "unknown_key", value: "x" }, // unknown key ignored
    );
    const settings = await getSiteSettings();
    expect(settings).toEqual({ upi_id: "override@upi", invoice_prefix: "BILL" });
    expect(await getSetting("upi_id")).toBe("override@upi");
  });

  it("an override beats the environment default", async () => {
    process.env.OWNER_UPI_ID = "env@upi";
    try {
      settingsRows.push({ key: "upi_id", value: "override@upi" });
      expect((await getOwnerUpi()).payeeVpa).toBe("override@upi");
      settingsRows.length = 0;
      expect((await getOwnerUpi()).payeeVpa).toBe("env@upi");
    } finally {
      delete process.env.OWNER_UPI_ID;
    }
  });

  it("exposes environment defaults for the form placeholders", () => {
    process.env.OWNER_UPI_ID = "env@upi";
    process.env.TROLIFT_INVOICE_PREFIX = "bill";
    try {
      const defaults = getEnvDefaults();
      expect(defaults.upi_id).toBe("env@upi");
      expect(defaults.invoice_prefix).toBe("BILL");
      expect(defaults.payment_window_hours).toBe("24");
      expect(defaults.quotation_validity_days).toBe("7");
      expect(defaults.default_low_stock_threshold).toBe("5");
    } finally {
      delete process.env.OWNER_UPI_ID;
      delete process.env.TROLIFT_INVOICE_PREFIX;
    }
  });
});

describe("saveSiteSettings", () => {
  it("upserts non-empty values and clears empty ones", async () => {
    const saved = await saveSiteSettings({
      upi_id: "trolift@upi",
      invoice_prefix: "  bill ",
      business_phone: "",
      quotation_validity_days: "15",
    });
    expect([...saved].sort()).toEqual([
      "business_phone",
      "invoice_prefix",
      "quotation_validity_days",
      "upi_id",
    ]);
    const cleared = writeOps.filter((op) => op.updateValues === undefined);
    expect(cleared).toHaveLength(1);
    const keyFilter = cleared[0]?.filters.find((f) => f.col === "key");
    expect(keyFilter?.val).toBe("business_phone");
    const upserted = writeOps
      .filter((op) => op.updateValues !== undefined)
      .map((op) => op.updateValues)
      .sort((a, b) =>
        String((a as { key: string }).key).localeCompare(
          String((b as { key: string }).key),
        ),
      );
    expect(upserted).toEqual([
      { key: "invoice_prefix", value: "BILL", updated_at: expect.any(String) },
      {
        key: "quotation_validity_days",
        value: "15",
        updated_at: expect.any(String),
      },
      { key: "upi_id", value: "trolift@upi", updated_at: expect.any(String) },
    ]);
  });

  it("rejects invalid values with field errors and writes nothing", async () => {
    await expect(
      saveSiteSettings({ upi_id: "nope", invoice_prefix: "BILL" }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      details: { upi_id: expect.any(String) },
    });
    expect(writeOps).toEqual([]);
  });

  it("treats unknown keys as ignored, absent keys as untouched", async () => {
    const saved = await saveSiteSettings({ something_else: "x" });
    expect(saved).toEqual([]);
    expect(writeOps).toEqual([]);
  });
});

describe("settings API route", () => {
  it("requires an admin session", async () => {
    authUser = null;
    expect((await GET(new Request("http://localhost/x"))).status).toBe(401);
    authUser = { id: "u1" };
    adminFlag = false;
    expect((await GET(new Request("http://localhost/x"))).status).toBe(403);
  });

  it("returns overrides and defaults for the form", async () => {
    settingsRows.push({ key: "upi_id", value: "override@upi" });
    const res = await GET(new Request("http://localhost/x"));
    const json = (await res.json()) as {
      ok: boolean;
      data: {
        overrides: Record<string, string>;
        defaults: Record<string, string>;
      };
    };
    expect(json.ok).toBe(true);
    expect(json.data.overrides).toEqual({ upi_id: "override@upi" });
    expect(json.data.defaults).toHaveProperty("invoice_prefix");
    expect(json.data.defaults).toHaveProperty("default_low_stock_threshold");
  });

  it("applies valid values and clears on empty strings", async () => {
    const res = await PUT(
      new Request("http://localhost/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upi_id: "trolift@upi", business_email: "" }),
      }),
    );
    const json = (await res.json()) as {
      ok: boolean;
      data: { saved: string[] };
    };
    expect(json.ok).toBe(true);
    expect([...json.data.saved].sort()).toEqual(["business_email", "upi_id"]);
  });

  it("rejects non-JSON, non-object bodies and invalid values", async () => {
    const garbage = await PUT(
      new Request("http://localhost/x", { method: "PUT", body: "oops" }),
    );
    expect(garbage.status).toBe(400);
    const arrayBody = await PUT(
      new Request("http://localhost/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "[]",
      }),
    );
    expect(arrayBody.status).toBe(400);
    const invalid = await PUT(
      new Request("http://localhost/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upi_id: "nope" }),
      }),
    );
    expect(invalid.status).toBe(422);
  });

  it("propagates write failures as 500s", async () => {
    handler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "site_settings") {
        return { rows: [], error: { message: "disk full" } };
      }
      throw new Error("unexpected");
    };
    const res = await PUT(
      new Request("http://localhost/x", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upi_id: "trolift@upi" }),
      }),
    );
    expect(res.status).toBe(500);
  });
});

describe("site_settings migration", () => {
  const sql = readFileSync(
    join(__dirname, "..", "supabase", "migrations", "0039_site_settings.sql"),
    "utf8",
  );

  it("creates the table with RLS and an admin-only policy", () => {
    expect(sql).toContain("create table public.site_settings");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("site_settings_admin_all");
    expect(sql).toContain("public.is_admin()");
    expect(sql).toContain("revoke all on public.site_settings from anon");
  });

  it("locks keys to a safe identifier shape", () => {
    expect(sql).toMatch(/\^\[a-z\]\[a-z0-9_\]\{1,60\}\$/);
  });
});

describe("settings helpers do not throw through fail-open reads", () => {
  it("getSiteSettings never rejects, even when the client is missing", async () => {
    // No env + no mock failure path: createAdminClient throws inside
    // the wrapper, which must swallow it.
    handler = () => {
      throw new Error("client construction failed");
    };
    await expect(getSiteSettings()).resolves.toEqual({});
    expect(isValidUpiVpa("a@b")).toBe(false);
    expect(AppError).toBeTypeOf("function");
  });
});
