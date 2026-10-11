import { revalidatePath } from "next/cache";
import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import {
  listDeliveryRates,
  parseAdminRateQuery,
  upsertDeliveryRate,
} from "@/lib/admin/delivery";
import type { RateFormInput } from "@/lib/admin/delivery-validation";

/** GET /api/admin/delivery/rates — searchable, paginated (admins only). */
export const GET = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const url = new URL(req.url);
  const params: Record<string, string | string[] | undefined> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return ok(await listDeliveryRates(parseAdminRateQuery(params)));
});

/** POST — create or update one (pincode, partner) rule. */
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
    return badRequest("Rate details are required.");
  }
  const result = await upsertDeliveryRate(coerceRateInput(body));
  revalidatePath("/admin/delivery");
  return ok(result, { status: result.created ? 201 : 200 });
});

export function coerceRateInput(body: unknown): RateFormInput {
  const r = body as Record<string, unknown>;
  return {
    pincode: String(r["pincode"] ?? ""),
    partnerId: String(r["partnerId"] ?? ""),
    serviceable: r["serviceable"] !== false,
    chargeRupees: String(r["chargeRupees"] ?? ""),
    remoteSurchargeRupees: String(r["remoteSurchargeRupees"] ?? ""),
    minOrderRupees: String(r["minOrderRupees"] ?? ""),
    maxOrderRupees: String(r["maxOrderRupees"] ?? ""),
    etaMinDays: String(r["etaMinDays"] ?? ""),
    etaMaxDays: String(r["etaMaxDays"] ?? ""),
  };
}
