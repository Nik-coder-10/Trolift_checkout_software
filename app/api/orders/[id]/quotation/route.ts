import { withErrorHandling } from "@/lib/api/handler";
import { notFound } from "@/lib/api/response";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { authorizeGuestRequest } from "@/lib/guest-access/guard";
import { getQuotationData } from "@/lib/quotations/service";
import { renderQuotationPdf } from "@/lib/quotations/pdf";
import { quotationPdfResponse } from "@/lib/quotations/response";

// pdfkit needs the Node runtime (no Edge).
export const runtime = "nodejs";

/**
 * GET /api/orders/[id]/quotation — the order's quotation/proforma PDF.
 *
 * Authorization mirrors the tax-invoice route: the HttpOnly guest
 * cookie for THIS order (or a one-time `?key=` bearer exchanged the
 * same way). The order UUID alone authorizes nothing. Unknown/malformed
 * ids and missing/invalid tokens all fail closed with 404 (no IDOR
 * oracle); non-provisional orders get 409, never a PDF. The `?id=`
 * query value is ignored. Rate-limited under the shared "invoice"
 * document budget (quotations and invoices are the same abuse class:
 * per-order PDFs).
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
  if (!ok) return notFound("Quotation not found.");
  const quotation = await getQuotationData(id);
  const pdf = await renderQuotationPdf(quotation);
  const inline = url.searchParams.get("disposition") === "inline";
  return quotationPdfResponse(quotation.quotationNumber, pdf, inline);
});
