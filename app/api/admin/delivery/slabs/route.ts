import { revalidatePath } from "next/cache";
import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import {
  createWeightSlab,
  listWeightSlabs,
} from "@/lib/admin/delivery";
import type { SlabFormInput } from "@/lib/admin/delivery-validation";

/** GET /api/admin/delivery/slabs — all weight bands (admins only). */
export const GET = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  return ok(await listWeightSlabs());
});

/** POST — create one band (overlap-checked per partner). */
export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.", 400);
  }
  if (typeof body !== "object" || body === null) {
    return badRequest("Slab details are required.");
  }
  const r = body as Record<string, unknown>;
  const result = await createWeightSlab({
    partnerId: String(r["partnerId"] ?? ""),
    minKg: String(r["minKg"] ?? ""),
    maxKg: String(r["maxKg"] ?? ""),
    chargeRupees: String(r["chargeRupees"] ?? ""),
  } satisfies SlabFormInput);
  revalidatePath("/admin/delivery");
  return ok(result, { status: 201 });
});
