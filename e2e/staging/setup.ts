import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Staging global setup: safety gates + test identities.
 *
 * - Re-verifies the loopback-only guards (defence in depth with the
 *   config file, which throws even earlier).
 * - Waits for /api/health on the target (proves baseURL + env).
 * - Ensures one admin identity (Auth Admin API + profiles.is_admin)
 *   and one plain non-admin identity, using synthetic credentials.
 * - Writes e2e/staging/.auth/identities.json (gitignored, 0600).
 *   Secrets never touch git, logs, or test artifacts.
 */

const AUTH_DIR = path.join(__dirname, ".auth");
const IDENTITIES = path.join(AUTH_DIR, "identities.json");

async function main(): Promise<void> {
  const baseURL = process.env.STAGING_BASE_URL ?? "http://127.0.0.1:3100";
  const supabaseUrl = (process.env.STAGING_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const anonKey = process.env.STAGING_SUPABASE_ANON_KEY ?? "";
  const serviceKey = process.env.STAGING_SERVICE_ROLE_KEY ?? "";

  const health = await fetch(`${baseURL}/api/health`);
  if (!health.ok) {
    throw new Error(`[staging-setup] Health check failed at ${baseURL} (${health.status}).`);
  }
  const body = (await health.json()) as { data?: { service?: string } };
  if (body?.data?.service !== "trolift-platform") {
    throw new Error("[staging-setup] Unexpected service identity. Refusing to run.");
  }

  const stamp = Date.now().toString(36);
  const adminEmail = `stge2e-admin-${stamp}@example.test`;
  const adminPassword = `StgE2E-${stamp}-Adm1n!`;
  const userEmail = `stge2e-user-${stamp}@example.test`;
  const userPassword = `StgE2E-${stamp}-User1!`;

  // Clean slate: remove synthetic leftovers from aborted runs (name
  // markers only — never real customer data).
  const { sweepStaleStaging } = await import("./helpers");
  const swept = await sweepStaleStaging();
  console.log(
    `[staging-setup] swept ${swept.orders} stale orders / ${swept.customers} stale customers.`,
  );

  const ensureUser = async (email: string, password: string, admin: boolean) => {
    // Create via Auth Admin API (idempotent per run: fresh addresses).
    const created = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!created.ok) {
      throw new Error(`[staging-setup] Could not create ${email}: ${created.status}`);
    }
    const user = (await created.json()) as { id: string };
    // profiles row (trigger-created or direct) + admin flag.
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    };
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ is_admin: admin }),
    });
    const check = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=id,is_admin`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    const rows = (await check.json()) as Array<{ id: string; is_admin: boolean }>;
    if (rows.length === 0) {
      const ins = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({ id: user.id, is_admin: admin }),
      });
      if (!ins.ok) {
        throw new Error(`[staging-setup] Could not provision profile for ${email}.`);
      }
    }
    return user.id;
  };

  const adminId = await ensureUser(adminEmail, adminPassword, true);
  const userId = await ensureUser(userEmail, userPassword, false);

  await fs.mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    IDENTITIES,
    JSON.stringify({ adminEmail, adminPassword, userEmail, userPassword, adminId, userId }, null, 2),
    { mode: 0o600 },
  );
  console.log("[staging-setup] identities provisioned (admin + plain user).");
}

export default async function globalSetup(): Promise<void> {
  await main();
}
