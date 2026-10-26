import { ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { requireAdmin } from "@/lib/auth/session";
import { createManualQuotation } from "@/lib/quotations/manual-service";

// pdfkit / node built-ins are used by the sibling PDF route; keep the
// maker on the Node runtime for the same (identical) config surface.
export const runtime = "nodejs";

/**
 * POST /api/admin/quotations — issue a manual quotation (quotation
 * maker). Body: the maker form (party, items, delivery, validity).
 *
 * Admins only. Every figure is recomputed server-side from the form:
 * the request never carries totals, tax splits or a quotation number,
 * so a tampered payload cannot print money that was never quoted.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const user = await requireAdmin();

  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.", 400);
  }

  const created = await createManualQuotation(body, user.id ?? null);
  return ok(created, { status: 201 });
});
