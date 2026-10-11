import { revalidatePath } from "next/cache";
import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { requireAdmin } from "@/lib/auth/session";
import { confirmImport } from "@/lib/admin/importer";

/**
 * POST /api/admin/delivery/rates/import — CSV bulk import (legacy path).
 * Body: { csv: string }. Delegates to the unified confirm pipeline:
 * every row is validated before anything is written; a file with any
 * invalid row commits nothing (422 + per-row errors). Valid files
 * apply atomically with a full summary — nothing is silently
 * discarded.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("import", await checkRateLimit(req, "import"));
  if (denied) return denied;
  const admin = await requireAdmin();
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.", 400);
  }
  const csv =
    typeof body === "object" && body !== null
      ? String((body as Record<string, unknown>)["csv"] ?? "")
      : "";
  if (csv.trim() === "") {
    return badRequest("CSV content is required.");
  }
  const summary = await confirmImport("rates", csv, admin.id);
  revalidatePath("/admin/delivery");
  return ok(summary);
});
