/**
 * Stock availability (pure core + thin RPC fetch).
 *
 * Customer-facing rule — mirrors public.product_availability() exactly:
 *   available <= 0         → out_of_stock
 *   available <= threshold → low_stock
 *   otherwise              → in_stock
 * Only the STATUS reaches the storefront; exact counts stay internal
 * (and are re-checked authoritatively at order time anyway).
 */

export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

/** Fallback threshold when a row carries none (static dev data). */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

export function stockStatus(
  available: number,
  threshold: number | null | undefined,
): StockStatus {
  const t =
    typeof threshold === "number" && Number.isFinite(threshold) && threshold >= 0
      ? Math.floor(threshold)
      : DEFAULT_LOW_STOCK_THRESHOLD;
  if (available <= 0) return "out_of_stock";
  if (available <= t) return "low_stock";
  return "in_stock";
}

/**
 * Admin-list stock tiers (reserve-aware counts get sharper copy than
 * the public three-state badge; exact numbers stay admin-only anyway):
 *   0        → out    "Out of stock"
 *   1        → critical "Only one remaining"
 *   2–3      → few    "Only few remaining"
 *   ≤ per-product threshold (default 5) → warning "Low stock remaining"
 *   above    → ok     (no badge)
 * Checked in that order, so 2–3 wins over the threshold tier.
 */
export type AdminStockTier = "out" | "critical" | "few" | "warning" | "ok";

export const ADMIN_STOCK_TIER_LABELS: Record<AdminStockTier, string> = {
  out: "Out of stock",
  critical: "Only one remaining",
  few: "Only few remaining",
  warning: "Low stock remaining",
  ok: "",
};

export function adminStockTier(
  available: number,
  threshold?: number | null,
): AdminStockTier {
  if (available <= 0) return "out";
  if (available === 1) return "critical";
  if (available <= 3) return "few";
  const t =
    typeof threshold === "number" && Number.isFinite(threshold) && threshold >= 0
      ? Math.floor(threshold)
      : DEFAULT_LOW_STOCK_THRESHOLD;
  if (available <= t) return "warning";
  return "ok";
}

export interface AvailabilityRow {
  productId: string;
  available: number;
  status: StockStatus;
}

/**
 * Minimal RPC surface both the real Supabase client (PostgREST builder
 * is thenable) and the unit-test mock satisfy. Awaited, never
 * .catch()-chained, so PromiseLike is sufficient on both sides.
 */
interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Reserve-aware availability for a batch of products via the
 * SECURITY DEFINER product_availability() RPC (works for anon +
 * authenticated callers — the function reveals per-product counts to
 * whoever asks, so UI layers must render `status` only).
 * Returns null on error; callers degrade to on-hand status for display
 * (selling decisions never use this — quote + create_order enforce).
 */
export async function fetchAvailability(
  client: RpcClient,
  productIds: string[],
): Promise<Map<string, AvailabilityRow> | null> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return new Map();
  try {
    const { data, error } = await client.rpc("product_availability", {
      p_ids: ids,
    });
    if (error) return null;
    // Table-returning RPCs arrive as arrays; normalise singletons
    // (unit-test doubles unwrap one-row results) the same way.
    const raw = (data ?? []) as unknown;
    const rows = (Array.isArray(raw) ? raw : [raw]) as Array<{
      product_id: string;
      available: number;
      low_stock_threshold: number;
      status: string;
    }>;
    const map = new Map<string, AvailabilityRow>();
    for (const r of rows) {
      const available = Number(r.available);
      map.set(r.product_id, {
        productId: r.product_id,
        available: Number.isFinite(available) ? Math.max(0, Math.floor(available)) : 0,
        status:
          r.status === "out_of_stock" || r.status === "low_stock" || r.status === "in_stock"
            ? r.status
            : stockStatus(0, r.low_stock_threshold),
      });
    }
    return map;
  } catch {
    return null;
  }
}
