import { withErrorHandling } from "@/lib/api/handler";
import { notFound } from "@/lib/api/response";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { authorizeGuestRequest } from "@/lib/guest-access/guard";
import { getInvoiceData } from "@/lib/invoices/service";
import { renderInvoicePdf } from "@/lib/invoices/pdf";
import { invoicePdfResponse } from "@/lib/invoices/response";

// pdfkit needs the Node runtime (no Edge).
export const runtime = "nodejs";

/**
 * GET /api/orders/[id]/invoice — the order's tax-invoice PDF.
 *
 * Authorization: the HttpOnly guest cookie for THIS order (or a
 * one-time `?key=` bearer exchanged the same way). The order UUID
 * alone authorizes nothing. Unknown/malformed ids and missing/invalid
 * tokens all fail closed with 404 (no IDOR oracle); unpaid orders get
 * 409, never a PDF. The `?id=` query value is ignored.
 */
export const GET = withErrorHandling(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const denied = await denyIfLimited(
    "invoice",
    await checkRateLimit(req, "invoice", { dims: { resourceId: id } }),
  );
  if (denied) return denied;
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  const ok = await authorizeGuestRequest(id, req, key);
  if (!ok) return notFound("Invoice not found.");
  const invoice = await getInvoiceData(id);
  const pdf = await renderInvoicePdf(invoice);
  const inline = url.searchParams.get("disposition") === "inline";
  return invoicePdfResponse(invoice.invoiceNumber, pdf, inline);
});
