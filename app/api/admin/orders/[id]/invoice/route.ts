import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { requireAdmin } from "@/lib/auth/session";
import { getInvoiceData } from "@/lib/invoices/service";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { invoicePdfResponse } from "@/lib/invoices/response";

// pdfkit needs the Node runtime (no Edge).
export const runtime = "nodejs";

/**
 * GET /api/admin/orders/[id]/invoice — tax-invoice PDF for admins.
 *
 * requireAdmin() first (401/403 before any order lookup, so anonymous
 * callers learn nothing). Same paid-only rule as the customer route:
 * admins also never receive an invoice labelled for an unpaid order.
 */
export const GET = withErrorHandling(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const denied = await denyIfLimited("invoice", await checkRateLimit(req, "invoice"));
  if (denied) return denied;
  await requireAdmin();
  const { id } = await params;
  const invoice = await getInvoiceData(id);
  const pdf = await renderInvoicePdf(invoice);
  const inline =
    new URL(req.url).searchParams.get("disposition") === "inline";
  return invoicePdfResponse(invoice.invoiceNumber, pdf, inline);
});
