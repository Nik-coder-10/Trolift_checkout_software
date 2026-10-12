import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { requireAdmin } from "@/lib/auth/session";
import { getQuotationData } from "@/lib/quotations/service";
import { renderQuotationPdf } from "@/lib/quotations/pdf";
import { quotationPdfResponse } from "@/lib/quotations/response";

// pdfkit needs the Node runtime (no Edge).
export const runtime = "nodejs";

/**
 * GET /api/admin/orders/[id]/quotation — quotation/proforma PDF for admins.
 *
 * requireAdmin() first (401/403 before any order lookup, so anonymous
 * callers learn nothing). Same provisional-only rule as the customer
 * route: admins never receive a quotation for a non-provisional order.
 * The admin forwards this document (e.g. over WhatsApp) manually —
 * nothing here sends it anywhere.
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
  await requireAdmin();
  const quotation = await getQuotationData(id);
  const pdf = await renderQuotationPdf(quotation);
  const inline =
    new URL(req.url).searchParams.get("disposition") === "inline";
  return quotationPdfResponse(quotation.quotationNumber, pdf, inline);
});
