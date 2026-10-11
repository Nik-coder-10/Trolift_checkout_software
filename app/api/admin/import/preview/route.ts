import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import {
  IMPORT_DATASETS,
  previewImport,
  type ImportDataset,
} from "@/lib/admin/importer";

/**
 * POST /api/admin/import/preview — dry-run any whitelisted dataset.
 * Body: { type: "products" | "rates", csv: string }.
 * Reads only: full parse + validation + create/update counts, zero
 * writes. The dataset whitelist is closed — arbitrary tables are
 * structurally unaddressable.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("import", await checkRateLimit(req, "import"));
  if (denied) return denied;
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
  return ok(await previewImport(type as ImportDataset, csv));
});
