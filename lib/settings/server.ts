import "server-only";
import { cache } from "react";
import { AppError } from "@/lib/api/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidUpiVpa } from "@/lib/payments/upi";
import { DEFAULT_LOW_STOCK_THRESHOLD } from "@/lib/inventory/availability";
import {
  isSettingKey,
  SETTING_KEYS,
  type SettingKey,
} from "@/lib/settings/keys";

/**
 * Site settings: database overrides over environment defaults.
 *
 * Reads are per-request memoised and FAIL OPEN — any database error or
 * invalid stored value falls back to the environment, so a broken
 * settings row can never take down invoicing, payments or checkout.
 * Writes go through validateSettingValue() (never raw) and require an
 * admin session (site_settings RLS is is_admin()).
 */

export type SiteSettings = Partial<Record<SettingKey, string>>;

/** Per-key value rules. Returns the trimmed value, or null = unusable. */
export function validateSettingValue(key: SettingKey, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value === "") return null;
  switch (key) {
    case "upi_id":
      return isValidUpiVpa(value) ? value : null;
    case "upi_payee_name":
      return value.length >= 2 && value.length <= 80 ? value : null;
    case "payment_window_hours": {
      const n = Number(value);
      return Number.isInteger(n) && n >= 1 && n <= 720 ? value : null;
    }
    case "invoice_prefix": {
      const upper = value.toUpperCase();
      return /^[A-Z]{2,10}$/.test(upper) ? upper : null;
    }
    case "quotation_validity_days": {
      const n = Number(value);
      return Number.isInteger(n) && n >= 1 && n <= 365 ? value : null;
    }
    case "business_phone":
      return /^\+?[0-9 ]{8,16}$/.test(value) ? value : null;
    case "business_email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? value : null;
    case "default_low_stock_threshold": {
      const n = Number(value);
      return Number.isInteger(n) && n >= 0 && n <= 1000 ? value : null;
    }
    default:
      return null;
  }
}

/** Effective overrides (validated); {} on any failure = env defaults. */
export const getSiteSettings = cache(async (): Promise<SiteSettings> => {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("site_settings").select("key, value");
    if (error || !Array.isArray(data)) return {};
    const settings: SiteSettings = {};
    for (const row of data as Array<{ key: unknown; value: unknown }>) {
      if (typeof row.key !== "string" || !isSettingKey(row.key)) continue;
      const value = validateSettingValue(row.key, row.value);
      if (value !== null) settings[row.key] = value;
    }
    return settings;
  } catch {
    return {};
  }
});

/** One override, or null when unset/invalid (callers use their env default). */
export async function getSetting(key: SettingKey): Promise<string | null> {
  const settings = await getSiteSettings();
  return settings[key] ?? null;
}

/**
 * Pure environment defaults per key (no database). The settings form
 * uses these as placeholders so untouched fields never become
 * overrides; getters fall back to exactly these values when a row is
 * absent or invalid.
 */
export function getEnvDefaults(): Record<SettingKey, string> {
  const env = process.env;
  const trimOr = (v: string | undefined, fallback: string) => {
    const t = (v ?? "").trim();
    return t === "" ? fallback : t;
  };
  return {
    upi_id: trimOr(env.OWNER_UPI_ID, ""),
    upi_payee_name: trimOr(env.OWNER_UPI_PAYEE_NAME, "Trolift Solutions"),
    payment_window_hours: trimOr(env.PAYMENT_WINDOW_HOURS, "24"),
    invoice_prefix: trimOr(env.TROLIFT_INVOICE_PREFIX, "INV").toUpperCase(),
    quotation_validity_days: trimOr(env.QUOTATION_VALIDITY_DAYS, "7"),
    business_phone: trimOr(env.TROLIFT_BUSINESS_PHONE, ""),
    business_email: trimOr(env.TROLIFT_BUSINESS_EMAIL, ""),
    default_low_stock_threshold: String(DEFAULT_LOW_STOCK_THRESHOLD),
  };
}

/**
 * Apply form payload edits to the stored overrides: a non-empty valid
 * value upserts; a present-but-empty value deletes the row (env default
 * takes over again); absent keys are left untouched. Invalid non-empty
 * values are rejected with field errors so the form can highlight them —
 * never silently dropped. Returns the keys that were written.
 */
export async function saveSiteSettings(
  payload: unknown,
): Promise<SettingKey[]> {
  const admin = createAdminClient();
  const record =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : {};

  const errors: Record<string, string> = {};
  const upserts: Array<{ key: SettingKey; value: string }> = [];
  const clears: SettingKey[] = [];
  for (const key of SETTING_KEYS) {
    if (!(key in record)) continue;
    const raw = record[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      clears.push(key);
      continue;
    }
    const value = validateSettingValue(key, raw);
    if (value === null) {
      errors[key] = `Enter a valid ${key.replace(/_/g, " ")}.`;
      continue;
    }
    upserts.push({ key, value });
  }
  if (Object.keys(errors).length > 0) {
    throw new AppError("VALIDATION_ERROR", "Some settings are invalid.", 422, errors);
  }

  for (const key of clears) {
    const { error } = await admin.from("site_settings").delete().eq("key", key);
    if (error) {
      throw new AppError("INTERNAL_ERROR", "Could not save settings. Please try again.", 500);
    }
  }
  for (const { key, value } of upserts) {
    const { error } = await admin
      .from("site_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) {
      throw new AppError("INTERNAL_ERROR", "Could not save settings. Please try again.", 500);
    }
  }
  return [...clears, ...upserts.map((u) => u.key)];
}
