import { revalidatePath } from "next/cache";
import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { requireAdmin } from "@/lib/auth/session";
import {
  IMPORT_DATASETS,
  confirmImport,
  type ImportDataset,
} from "@/lib/admin/importer";

/**
 * POST /api/admin/import/confirm — commit a whitelisted dataset.
 * Body: { type: "products" | "rates", csv: string }.
 * Re-validates from raw CSV (previews are never trusted), rejects the
 * whole file on any invalid row with zero writes, otherwise applies
 * inside one database transaction and audits the result.
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
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const type = String(record["type"] ?? "");
  if (!(IMPORT_DATASETS as string[]).includes(type)) {
    return badRequest("Unknown import type. Allowed: products, rates.");
  }
  const csv = String(record["csv"] ?? "");
  if (csv.trim() === "") {
    return badRequest("CSV content is required.");
  }
  const result = await confirmImport(
    type as ImportDataset,
    csv,
    admin.id,
  );
  revalidatePath("/admin/products");
  revalidatePath("/admin/delivery");
  return ok(result);
});
