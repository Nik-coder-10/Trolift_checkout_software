import { badRequest, notFound, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { getAdminCustomer, updateAdminCustomer } from "@/lib/admin/customers";

/** GET /api/admin/customers/[id] — profile + summary + history. */
export const GET = withErrorHandling(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const { id } = await params;
  const detail = await getAdminCustomer(id);
  if (!detail) return notFound("Customer not found.");
  return ok(detail);
});

/**
 * PATCH /api/admin/customers/[id] — edit the CURRENT profile only.
 * Historical order snapshots are separate rows and never change.
 */
export const PATCH = withErrorHandling(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const { id } = await params;
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.", 400);
  }
  if (typeof body !== "object" || body === null) {
    return badRequest("Customer details are required.");
  }
  const r = body as Record<string, unknown>;
  // Full-replacement like the contact fields: absent billing clears
  // the profile. The admin form always sends the complete profile.
  const b =
    typeof r["billing"] === "object" && r["billing"] !== null
      ? (r["billing"] as Record<string, unknown>)
      : {};
  await updateAdminCustomer(id, {
    name: String(r["name"] ?? ""),
    phone: String(r["phone"] ?? ""),
    email: String(r["email"] ?? ""),
    gstin: String(r["gstin"] ?? ""),
    billingName: String(b["name"] ?? ""),
    billingAddressLine: String(b["addressLine"] ?? ""),
    billingCity: String(b["city"] ?? ""),
    billingStateCode: String(b["stateCode"] ?? ""),
    billingPincode: String(b["pincode"] ?? ""),
  });
  return ok({ id });
});
