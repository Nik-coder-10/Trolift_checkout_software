import { notFound } from "@/lib/api/response";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { requireAdmin } from "@/lib/auth/session";
import {
  EXPORT_DATASETS,
  buildExport,
  type ExportDataset,
} from "@/lib/admin/exporter";

/**
 * GET /api/admin/export/[type] — streamed CSV download (admins only).
 *
 * The type whitelist is closed (products | rates | customers |
 * orders): anything else 404s, so no arbitrary table can ever be
 * addressed. Columns are fixed per dataset — credentials, tokens and
 * secrets are structurally unexportable. Generation streams in
 * server-side chunks; the bulk read is audit-logged.
 */
export const GET = withErrorHandling(async (
  req: Request,
  { params }: { params: Promise<{ type: string }> },
) => {
  const denied = await denyIfLimited("export", await checkRateLimit(req, "export"));
  if (denied) return denied;
  const admin = await requireAdmin();
  const { type } = await params;
  if (!(EXPORT_DATASETS as string[]).includes(type)) {
    return notFound("Unknown export type.");
  }
  const { filename, stream } = await buildExport(
    type as ExportDataset,
    admin.id,
  );
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
