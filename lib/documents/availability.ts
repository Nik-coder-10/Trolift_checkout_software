import { canIssueInvoice } from "@/lib/invoices/data";
import { canIssueQuotation } from "@/lib/quotations/data";

/**
 * Which order documents the UI may offer for download (pure rules).
 *
 * These predicates mirror the document routes' own gates — the page
 * must never offer an action the route would refuse for a FRESH
 * document. One deliberate exception is documented below (refunded
 * orders with an already-frozen invoice).
 *
 *   * Tax invoice — paid only (canIssueInvoice). An unpaid order must
 *     never be offered a document labelled "TAX INVOICE".
 *   * Quotation — a frozen quotation stays downloadable forever (the
 *     route returns the frozen row BEFORE re-checking eligibility), and
 *     a still-provisional order can be quoted on demand (the route
 *     issues, numbers and freezes it).
 *
 * Refunded orders (conservative, intentional): the invoice service
 * returns an already-frozen invoice before re-checking the paid gate,
 * so a direct admin route request for a paid-then-refunded order is
 * still served (record-keeping). The UI nevertheless hides the invoice
 * action once paymentStatus leaves "paid": offering a document labelled
 * "TAX INVOICE" against a currently-unpaid order would contradict the
 * paid-only labelling rule, and the established business policy
 * (canIssueInvoice: ONLY "paid" gets an invoice) is not ours to relax
 * without owner evidence. No policy is changed here — the route keeps
 * serving direct admin re-downloads, and the panel explains the absence.
 *
 * UI visibility is NOT a security boundary: /api/admin/orders/[id]/
 * {invoice,quotation} re-run requireAdmin() and the same eligibility
 * checks server-side, and the customer routes require the per-order
 * guest token. Hiding an action here only removes dead ends — it never
 * grants or revokes access.
 */

/** Paid-only rule, single-sourced with the invoice service + route. */
export function canDownloadInvoice(paymentStatus: string): boolean {
  return canIssueInvoice(paymentStatus);
}

export interface QuotationAction {
  /** An action may be rendered at all. */
  available: boolean;
  /** A frozen quotation already exists (a plain re-download). */
  existing: boolean;
}

/**
 * Frozen quotation → downloadable from any order status. Otherwise the
 * action is offered only while the order is still provisional, where
 * the route issues the quotation on first request.
 */
export function quotationAction(
  orderStatus: string,
  hasFrozenQuotation: boolean,
): QuotationAction {
  if (hasFrozenQuotation) return { available: true, existing: true };
  return { available: canIssueQuotation(orderStatus), existing: false };
}
