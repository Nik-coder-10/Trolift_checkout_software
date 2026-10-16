import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { quoteDelivery, NOT_SERVICEABLE_MESSAGE } from "@/lib/delivery/engine";
import { normalizePincode } from "@/lib/validations/common";

/**
 * POST /api/delivery/check — { pincode, subtotalPaise?, items? } → verdict.
 *
 * All-inclusive pricing: the check answers ONE question — is this
 * pincode serviceable? — plus the serving partner/ETA when it is.
 * Delivery charges are never quoted (they are already inside the
 * catalogue price), and an unserviceable pincode returns the
 * nearby-pincode message verbatim. Server authority: validates the
 * pincode, queries trusted rate rows and Delhivery coverage; items
 * carry IDs + quantities ONLY. Creates nothing.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("delivery", await checkRateLimit(req, "delivery"));
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
  const pincode = normalizePincode(String(record["pincode"] ?? ""));
  if (pincode === "") {
    return badRequest("Delivery pincode is required.");
  }
  const rawSubtotal = record["subtotalPaise"];
  const subtotalPaise =
    rawSubtotal === undefined || rawSubtotal === null
      ? undefined
      : Number(rawSubtotal);
  if (
    subtotalPaise !== undefined &&
    (!Number.isInteger(subtotalPaise) || subtotalPaise < 0)
  ) {
    return badRequest("Order subtotal must be a non-negative integer.");
  }
  // IDs + quantities only. Anything else on the items (weight, price,
  // charge, availability) is dropped before the engine sees it.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const rawItems = record["items"];
  let items: Array<{ productId: string; quantity: number }> | undefined;
  if (rawItems !== undefined && rawItems !== null) {
    if (!Array.isArray(rawItems) || rawItems.length > 50) {
      return badRequest("Items must be a list of up to 50 entries.");
    }
    items = [];
    for (const raw of rawItems) {
      if (typeof raw !== "object" || raw === null) {
        return badRequest("Each item needs a productId and a quantity.");
      }
      const row = raw as Record<string, unknown>;
      const productId = String(row["productId"] ?? "");
      const quantity = row["quantity"];
      if (!UUID_RE.test(productId)) {
        return badRequest("One of the products is invalid.");
      }
      if (
        typeof quantity !== "number" ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 999
      ) {
        return badRequest("Quantities must be whole numbers from 1 to 999.");
      }
      items.push({ productId, quantity });
    }
  }
  const quote = await quoteDelivery(pincode, subtotalPaise, items ?? []);
  // Orders require a priced partner row — the same gate quoteOrder
  // applies — so "serviceable" here means exactly "orderable here".
  const serviceable = Boolean(quote.serviceable && quote.selected);
  if (!serviceable) {
    return ok({
      serviceable: false,
      pincode: quote.pincode,
      coverage: quote.coverage,
      message: NOT_SERVICEABLE_MESSAGE,
      partner: null,
      etaDays: null,
    });
  }
  return ok({
    serviceable: true,
    pincode: quote.pincode,
    coverage: quote.coverage,
    message: "Delivery is included in the product price.",
    partner: quote.selected?.partner ?? null,
    etaDays: quote.selected?.etaDays ?? null,
  });
});
