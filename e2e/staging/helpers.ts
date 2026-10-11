import { promises as fs } from "node:fs";
import path from "node:path";
import type { APIRequestContext, Browser, Page } from "@playwright/test";

export interface Identities {
  adminEmail: string;
  adminPassword: string;
  userEmail: string;
  userPassword: string;
  adminId: string;
  userId: string;
}

export async function loadIdentities(): Promise<Identities> {
  const raw = await fs.readFile(path.join(__dirname, ".auth", "identities.json"), "utf8");
  return JSON.parse(raw) as Identities;
}

/** Unique 10-digit national mobile (validator accepts 6–9 leading). */
export function uniquePhone(): string {
  const tail = Date.now().toString().slice(-9).padStart(9, "0");
  return `9${tail}`;
}

/** Canonical stored form (+91 prefix) for direct backend queries. */
export function asStoredPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  return `+91${national}`;
}

/** Unique UTR-length reference (6–30 chars). */
export function uniqueUtr(prefix = "STGE2E"): string {
  return `${prefix}${Date.now().toString(36).toUpperCase()}`.slice(0, 24);
}

export function serviceHeaders(): Record<string, string> {
  const key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export function supabaseRest(): string {
  return `${(process.env.STAGING_SUPABASE_URL ?? "").replace(/\/+$/, "")}/rest/v1`;
}

/** Playwright's baseURL fixture types as optional; staging requires it. */
export function mustBase(baseURL: string | undefined): string {
  if (!baseURL) throw new Error("[staging-e2e] baseURL missing. Refusing to run.");
  return baseURL;
}

/** Track synthetic customer phones created during a run for cleanup. */
export const trackedPhones: string[] = [];
export const trackedProductIds: string[] = [];

export function trackPhone(phone: string): string {
  trackedPhones.push(phone);
  return phone;
}

/** Sign in through the real admin login form. */
export async function adminLogin(page: Page, ids: Identities): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(ids.adminEmail);
  await page.getByLabel("Password").fill(ids.adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Exact /admin (NOT /admin/login): the login POST + redirect must
  // complete. A loose /admin/ prefix would match the login page itself
  // and race the in-flight submission.
  await page.waitForURL(/\/admin$/, { timeout: 30_000 });
}

/** Sign in as the plain non-admin user. */
export async function userLogin(page: Page, ids: Identities): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(ids.userEmail);
  await page.getByLabel("Password").fill(ids.userPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Auth succeeds (→ /admin) but the protected layout gates roles.
  await page.waitForURL(/\/admin$/, { timeout: 30_000 });
}

/** Fresh contexts: isolated customer + admin sessions in one test. */
export async function freshContexts(browser: Browser): Promise<{
  customer: { page: Page; close: () => Promise<void> };
  admin: { page: Page; close: () => Promise<void> };
}> {
  const customerCtx = await browser.newContext();
  const adminCtx = await browser.newContext();
  return {
    customer: { page: await customerCtx.newPage(), close: () => customerCtx.close() },
    admin: { page: await adminCtx.newPage(), close: () => adminCtx.close() },
  };
}

/**
 * Create a fixture order through the supported app API (real validation,
 * real RPC) and return its id + number parsed from the confirmation URL.
 * Used only to SET UP scenarios whose transitions are then driven via UI.
 */
export async function createFixtureOrder(
  request: APIRequestContext,
  baseURL: string,
  input: { productId: string; quantity: number; phone: string },
): Promise<{ id: string; orderNumber: string; totalPaise: number; token: string }> {
  const { randomUUID } = await import("node:crypto");
  const res = await request.post(`${baseURL}/api/orders`, {
    data: {
      items: [{ productId: input.productId, quantity: input.quantity }],
      customer: { name: "STGE2E Fixture", phone: input.phone },
      pincode: "400001",
      idempotencyKey: randomUUID(),
    },
  });
  if (!res.ok()) throw new Error(`fixture order failed: ${res.status()}`);
  const json = (await res.json()) as {
    data: { id: string; orderNumber: string; totalPaise: number; guestToken: string };
  };
  return { id: json.data.id, orderNumber: json.data.orderNumber, totalPaise: json.data.totalPaise, token: json.data.guestToken };
}

export async function seedProductId(): Promise<string> {
  const res = await fetch(
    `${supabaseRest()}/products?slug=eq.heavy-duty-platform-trolley-500kg&select=id`,
    { headers: serviceHeaders() },
  );
  const rows = (await res.json()) as Array<{ id: string }>;
  if (rows.length === 0) throw new Error("seed product missing");
  return rows[0]!.id;
}

/** Phone of the shared journey order, if 1-customer has recorded one. */
async function journeyPhone(): Promise<string | null> {
  try {
    const raw = await fs.readFile(
      path.join(__dirname, ".auth", "journey.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { phone?: string };
    return parsed.phone ?? null;
  } catch {
    return null;
  }
}

/**
 * Delete ONLY tracked test records (orders cascade to children; products
 * last: order_items RESTRICT).
 *
 * The shared journey order (1-customer → 2-admin → 3-auth → 4-failure)
 * outlives any single spec, so per-file cleanup NEVER removes it: a
 * mid-run sweep used to delete it and made the later journey specs fail
 * with a misleading "Order not found". Only the final sweep opts in via
 * `includeJourney`.
 */
export async function cleanupRun(
  options: { includeJourney?: boolean } = {},
): Promise<void> {
  const protectedPhone = options.includeJourney ? null : await journeyPhone();
  const phones = trackedPhones.splice(0);
  if (options.includeJourney) {
    const journey = await journeyPhone();
    if (journey && !phones.includes(journey)) phones.push(journey);
  }
  await cleanupPhones(phones.filter((p) => p !== protectedPhone));
  for (const productId of trackedProductIds.splice(0)) {
    await fetch(`${supabaseRest()}/products?id=eq.${productId}`, {
      method: "DELETE",
      headers: serviceHeaders(),
    });
  }
}

/** Sweep stale synthetic records from aborted runs (name markers only). */
export async function sweepStaleStaging(): Promise<{ orders: number; customers: number }> {
  const base = supabaseRest();
  const headers = serviceHeaders();
  const asRows = (value: unknown): Array<{ id: string }> =>
    Array.isArray(value) ? (value as Array<{ id: string }>) : [];
  const custRes = await fetch(`${base}/customers?name=like.STGE2E%25&select=id`, { headers });
  if (!custRes.ok) {
    throw new Error(`[staging-setup] stale-customer sweep failed: HTTP ${custRes.status}`);
  }
  const custs = asRows(await custRes.json());
  let orders = 0;
  for (const c of custs) {
    const ordersRes = await fetch(`${base}/orders?customer_id=eq.${c.id}&select=id`, { headers });
    const found = asRows(await ordersRes.json());
    for (const o of found) {
      for (const t of ["order_access_tokens", "order_events", "stock_reservations", "payments", "order_items", "invoices", "shipments"]) {
        await fetch(`${base}/${t}?order_id=eq.${o.id}`, { method: "DELETE", headers });
      }
      await fetch(`${base}/orders?id=eq.${o.id}`, { method: "DELETE", headers });
      orders += 1;
    }
    await fetch(`${base}/customers?id=eq.${c.id}`, { method: "DELETE", headers });
  }
  // Fixture products last (order_items RESTRICT while orders exist).
  const prodRes = await fetch(`${base}/products?or=(name.like.STGE2E%25,slug.like.stge2e-%25)&select=id`, { headers });
  const prods = asRows(await prodRes.json());
  for (const p of prods) {
    await fetch(`${base}/products?id=eq.${p.id}`, { method: "DELETE", headers });
  }
  return { orders, customers: custs.length };
}

async function cleanupPhones(phones: string[]): Promise<void> {
  const base = supabaseRest();
  const headers = serviceHeaders();
  for (const phone of phones) {
    const stored = asStoredPhone(phone);
    const custRes = await fetch(`${base}/customers?phone=eq.${encodeURIComponent(stored)}&select=id`, { headers });
    const custs = (await custRes.json()) as Array<{ id: string }>;
    for (const c of custs) {
      const ordersRes = await fetch(`${base}/orders?customer_id=eq.${c.id}&select=id`, { headers });
      const orders = (await ordersRes.json()) as Array<{ id: string }>;
      for (const o of orders) {
        for (const t of ["order_access_tokens", "order_events", "stock_reservations", "payments", "order_items", "invoices", "shipments"]) {
          await fetch(`${base}/${t}?order_id=eq.${o.id}`, { method: "DELETE", headers });
        }
        await fetch(`${base}/orders?id=eq.${o.id}`, { method: "DELETE", headers });
      }
      await fetch(`${base}/customers?id=eq.${c.id}`, { method: "DELETE", headers });
    }
  }
}
