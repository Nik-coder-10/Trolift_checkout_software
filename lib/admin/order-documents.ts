import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import {
  canDownloadInvoice,
  quotationAction,
  type QuotationAction,
} from "@/lib/documents/availability";

/**
 * Admin document actions for one order (server-only, admins only).
 *
 * Read-only by design: rendering the order page must never issue a
 * document. Numbering + freezing happen in the download routes
 * themselves (first request wins), so this module only decides whether
 * the UI offers a plain re-download (frozen row exists) or an
 * on-demand issuance, plus which statuses are eligible at all.
 *
 * Authorization is re-asserted here (requireAdmin) and the frozen
 * quotation is read through the RLS-respecting server client under the
 * quotations_admin_all policy — the service-role client is never used
 * for admin UI reads. Read failures fail closed: the quotation action
 * degrades to the eligibility rule and the route stays the source of
 * truth, so a stale/absent link can never leak another order's
 * document or bypass a check.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Frozen quotation identity used for labels (never the document body). */
export interface FrozenQuotationSummary {
  quotationNumber: string;
  validTill: string;
}

export interface OrderDocumentActions {
  invoice: { available: boolean; href: string };
  quotation: QuotationAction & {
    href: string;
    quotationNumber: string | null;
    validTill: string | null;
  };
}

/**
 * Existing (frozen) quotation for an order, or null. Unknown/malformed
 * ids and read errors both return null — never a partial row and never
 * a query for a non-UUID (the column is uuid-typed).
 *
 * "Frozen" uses the download service's own criteria (see
 * asFrozenQuotation in lib/quotations/service.ts): the row's `data`
 * must be a version-1 quotation payload. A claimed-but-unfrozen row
 * (`data` still null between number claim and freeze) is NOT treated
 * as frozen — the UI falls back to the provisional eligibility rule
 * and the route stays the source of truth, so the panel can never
 * offer a re-download the route would refuse with 409.
 */
async function readFrozenQuotation(
  orderId: string,
): Promise<FrozenQuotationSummary | null> {
  if (!UUID_RE.test(orderId)) return null;
  const client = await createClient();
  const { data, error } = await client
    .from("quotations")
    .select("quotation_number,valid_till,data")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) return null;
  const row = data as {
    quotation_number: string;
    valid_till: string;
    data: unknown;
  } | null;
  if (!row) return null;
  const payload = row.data;
  const frozen =
    typeof payload === "object" &&
    payload !== null &&
    (payload as { version?: unknown }).version === 1 &&
    (payload as { kind?: unknown }).kind === "quotation";
  if (!frozen) return null;
  return {
    quotationNumber: row.quotation_number,
    validTill: row.valid_till,
  };
}

export async function getOrderDocumentActions(order: {
  id: string;
  paymentStatus: string;
  orderStatus: string;
}): Promise<OrderDocumentActions> {
  await requireAdmin();
  const quotation = await readFrozenQuotation(order.id);
  const id = encodeURIComponent(order.id);
  return {
    invoice: {
      available: canDownloadInvoice(order.paymentStatus),
      href: `/api/admin/orders/${id}/invoice`,
    },
    quotation: {
      ...quotationAction(order.orderStatus, quotation !== null),
      href: `/api/admin/orders/${id}/quotation`,
      quotationNumber: quotation?.quotationNumber ?? null,
      validTill: quotation?.validTill ?? null,
    },
  };
}
