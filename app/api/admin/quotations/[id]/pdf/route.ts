import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { requireAdmin } from "@/lib/auth/session";
import { getManualQuotation } from "@/lib/quotations/manual-service";
import { renderQuotationPdf } from "@/lib/quotations/pdf";
import { quotationPdfResponse } from "@/lib/quotations/response";

// pdfkit needs the Node runtime (no Edge).
export const runtime = "nodejs";

/**
 * GET /api/admin/quotations/[id]/pdf — download a manual quotation.
 *
 * requireAdmin() before the lookup, so anonymous callers learn nothing
 * about whether a quotation exists. The stored document is rendered
 * verbatim: reprints always match what was issued.
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
  const { data } = await getManualQuotation(id);
  const pdf = await renderQuotationPdf(data);
  const inline =
    new URL(req.url).searchParams.get("disposition") === "inline";
  return quotationPdfResponse(data.quotationNumber, pdf, inline);
});
