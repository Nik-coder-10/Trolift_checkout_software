import { AppError } from "@/lib/api/errors";
import {
  EMPTY_BILLING_FORM,
  normalizeBillingForm,
  normalizeCheckoutForm,
  validateCheckoutForm,
  type BillingFormData,
  type CheckoutFormData,
} from "@/lib/checkout/validation";
import { COUPON_CODE_RE, normalizeCouponCode } from "@/lib/coupons/code";
import { ORDER_MAX_QTY } from "@/lib/orders/quote";

/**
 * Order request parsing + validation (pure, unit-tested).
 *
 * Accepts ONLY: item IDs + quantities, customer details (incl. the
 * shipping address and optional billing profile), pincode and an
 * idempotency key. There is
 * deliberately no field for prices, rates, charges, totals, partner,
 * payment status or order status — the server derives all of those,
 * so a hostile client cannot even submit fakes.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OrderRequestItem {
  productId: string;
  quantity: number;
}

export interface ParsedOrderRequest {
  items: OrderRequestItem[];
  customer: {
    name: string;
    phone: string;
    email: string | null;
    gstin: string | null;
  };
  billing: {
    gstin: string | null;
    stateCode: string | null;
    name: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  } | null;
  pincode: string;
  /** Delivery address as typed at checkout — required for every order. */
  shippingAddress: string;
  /** Redeem code applied at checkout ("" when no offer was used). */
  couponCode: string;
  idempotencyKey: string;
}

function fail(message: string, status = 400): never {
  throw new AppError("VALIDATION_ERROR", message, status);
}

export function parseOrderRequestBody(body: unknown): ParsedOrderRequest {
  if (typeof body !== "object" || body === null) {
    fail("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;

  const rawItems = record["items"];
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    fail("The order must contain at least one item.");
  }
  const items: OrderRequestItem[] = rawItems.map((raw) => {
    if (typeof raw !== "object" || raw === null) {
      fail("Each item needs a productId and a quantity.");
    }
    const row = raw as Record<string, unknown>;
    const productId = String(row["productId"] ?? "");
    const quantity = row["quantity"];
    if (!UUID_RE.test(productId)) {
      fail("One of the products is invalid.");
    }
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > ORDER_MAX_QTY
    ) {
      fail(`Quantities must be whole numbers from 1 to ${ORDER_MAX_QTY}.`);
    }
    return { productId, quantity };
  });

  const rawCustomer = record["customer"];
  if (typeof rawCustomer !== "object" || rawCustomer === null) {
    fail("Customer details are required.");
  }
  const c = rawCustomer as Record<string, unknown>;
  // A billing object marks a business/GST order; the server infers the
  // type from payload shape rather than trusting a client type flag.
  const rawBilling = record["billing"];
  const hasBillingProfile = rawBilling !== undefined && rawBilling !== null;
  let billingForm: BillingFormData = { ...EMPTY_BILLING_FORM };
  if (hasBillingProfile) {
    if (typeof rawBilling !== "object") {
      fail("Billing details are invalid.");
    }
    const b = rawBilling as Record<string, unknown>;
    billingForm = {
      name: String(b["name"] ?? ""),
      addressLine: String(b["addressLine"] ?? ""),
      city: String(b["city"] ?? ""),
      stateCode: String(b["stateCode"] ?? ""),
      pincode: String(b["pincode"] ?? ""),
    };
  }
  const form: CheckoutFormData = {
    name: String(c["name"] ?? ""),
    phone: String(c["phone"] ?? ""),
    email: String(c["email"] ?? ""),
    gstin: String(c["gstin"] ?? ""),
    pincode: String(record["pincode"] ?? ""),
    shippingAddress: String(record["shippingAddress"] ?? ""),
    customerType: hasBillingProfile ? "business" : "individual",
    billing: billingForm,
  };
  const validation = validateCheckoutForm(form, items.length);
  if (!validation.valid) {
    const first = (
      [
        "name",
        "phone",
        "email",
        "gstin",
        "billing.name",
        "billing.addressLine",
        "billing.city",
        "billing.stateCode",
        "billing.pincode",
        "pincode",
        "shippingAddress",
      ] as const
    ).find((f) => validation.errors[f]);
    fail(
      (first && validation.errors[first]) ||
        "Customer details are incomplete.",
      422,
    );
  }
  const customer = normalizeCheckoutForm(form);

  // GST is triggered by the GSTIN. A complete profile flows through
  // (business path guarantees completeness above); a lone GSTIN without
  // a profile is taxed inter-state (IGST) so older clients keep working.
  // No GSTIN → no billing identity, no tax.
  let billing: ParsedOrderRequest["billing"] = null;
  if (customer.gstin !== null) {
    if (!hasBillingProfile) {
      billing = {
        gstin: customer.gstin,
        stateCode: null,
        name: null,
        addressLine: null,
        city: null,
        state: null,
        pincode: null,
      };
    } else {
      const normalized = normalizeBillingForm(billingForm, customer.gstin);
      if (!normalized) {
        fail("Billing details are incomplete.", 422);
      }
      billing = normalized;
    }
  }

  const idempotencyKey = String(record["idempotencyKey"] ?? "");
  if (!UUID_RE.test(idempotencyKey)) {
    fail("A valid idempotency key is required.");
  }

  // Shape-only: the code itself (active? first order? window?) is
  // resolved server-side after quoting — never by the client.
  const couponCode = normalizeCouponCode(record["couponCode"]);
  if (couponCode !== "" && !COUPON_CODE_RE.test(couponCode)) {
    fail("Enter a valid redeem code.", 422);
  }

  return {
    items,
    customer,
    billing,
    pincode: customer.pincode,
    shippingAddress: customer.shippingAddress,
    couponCode,
    idempotencyKey,
  };
}
