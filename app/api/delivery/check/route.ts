import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { quoteDelivery } from "@/lib/delivery/engine";
import { normalizePincode } from "@/lib/validations/common";

/**
 * POST /api/delivery/check — { pincode, subtotalPaise?, items? } → quote.
 *
 * Server authority: validates the pincode, queries trusted rate rows,
 * applies the selection strategy and returns the verdict. Items carry
 * IDs + quantities ONLY — weights, categories and prices are re-fetched
 * live, so forged client figures (weight, charge, availability) are
 * structurally ignored. The browser only displays the verdict; the
 * order API repeats the calculation and never trusts client money.
 * Creates nothing.
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
  return ok({
    serviceable: quote.serviceable,
    pincode: quote.pincode,
    // Delhivery list coverage: listed/oda/state + the deliverable
    // verdict behind `serviceable` (same for every consumer).
    coverage: quote.coverage,
    // Canonical DeliveryQuote shape (CheckoutForm reads `selected`).
    // The flattened partner/charge fields stay for older consumers.
    selected: quote.selected,
    partner: quote.selected?.partner ?? null,
    deliveryChargePaise: quote.selected?.deliveryChargePaise ?? null,
    ...(quote.selected?.etaDays ? { etaDays: quote.selected.etaDays } : {}),
    options: quote.options,
    totalWeightKg: quote.totalWeightKg,
    freightPaise: quote.freightPaise,
    remotePaise: quote.remotePaise,
    handlingPaise: quote.handlingPaise,
    appliedRules: quote.appliedRules,
    subtotalPaise: quote.subtotalPaise,
    ...(quote.reason ? { reason: quote.reason } : {}),
  });
});
