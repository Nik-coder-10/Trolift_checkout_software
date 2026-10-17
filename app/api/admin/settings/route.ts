import { revalidatePath } from "next/cache";
import { ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { requireAdmin } from "@/lib/auth/session";
import { getEnvDefaults, getSiteSettings, saveSiteSettings } from "@/lib/settings/server";

/**
 * GET /api/admin/settings — effective overrides + environment defaults.
 * The form shows overrides as values and defaults as placeholders, so
 * an untouched field never becomes a stored override.
 */
export const GET = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  await requireAdmin();
  return ok({ overrides: await getSiteSettings(), defaults: getEnvDefaults() });
});

/** PUT /api/admin/settings — apply form values ("" clears an override). */
export const PUT = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  await requireAdmin();
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.", 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("BAD_REQUEST", "Settings values are required.", 400);
  }
  const saved = await saveSiteSettings(body);
  revalidatePath("/admin/settings");
  return ok({ saved });
});
