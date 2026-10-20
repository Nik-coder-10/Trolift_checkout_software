import { after } from "next/server";
import { badRequest, ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import { authorizeGuestRequest } from "@/lib/guest-access/guard";
import { submitPaymentClaim } from "@/lib/payments/submit";
import {
  assertValidProofFile,
  uploadPaymentProof,
} from "@/lib/storage/payment-proofs";
import { notifyPaymentClaimSubmitted } from "@/lib/notifications/payment-notifications";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/payments/claim — multipart/form-data with a payment
 * screenshot: { orderId, reference?, phone, screenshot } → SUBMITTED.
 *
 * Dual authorization (both required, neither weakened):
 *  1. The HttpOnly guest token for THIS order (cookie or `accessToken`
 *     form field for non-cookie clients), and
 *  2. the existing phone-match against the order's customer.
 * Accepts NO amount — the authoritative total stays server-side.
 * The screenshot (PNG/JPEG/WebP ≤ 5 MB, sniffed by magic bytes) is
 * mandatory and lands in the private payment-proofs bucket; its path
 * is stored on the payment row for verification. The UPI reference is
 * optional — when given it must be well-formed; when omitted the
 * screenshot alone carries the claim. Never marks anything paid; only
 * pending/failed payments in payable order states may transition.
 * Failures are generic (404) so arbitrary order UUIDs are not
 * confirmed to exist.
 *
 * After the response is on the wire, `after()` emails the owner the
 * client details, payment reference (if any) and the screenshot
 * attachment. An email or storage outage is logged and never fails a
 * committed claim.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("claim", await checkRateLimit(req, "claim"));
  if (denied) return denied;
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return badRequest("Request must be multipart/form-data with a payment screenshot.");
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Request must be multipart/form-data with a payment screenshot.");
  }
  const orderId = String(form.get("orderId") ?? "");
  const reference = String(form.get("reference") ?? "");
  const phone = String(form.get("phone") ?? "");
  const accessToken =
    typeof form.get("accessToken") === "string"
      ? (form.get("accessToken") as string)
      : null;
  const screenshot = form.get("screenshot");
  if (!UUID_RE.test(orderId)) {
    return badRequest("A valid order is required.");
  }
  if (phone.trim() === "") {
    return badRequest("The mobile number from the order is required.");
  }
  if (!(screenshot instanceof File)) {
    return badRequest("Attach the screenshot of your payment.");
  }
  const authorized = await authorizeGuestRequest(orderId, req, accessToken);
  if (!authorized) {
    throw new AppError("NOT_FOUND", "Order not found.", 404);
  }
  // Sniffed type drives storage and the email attachment — a spoofed
  // declared type or extension never reaches the bucket.
  const bytes = new Uint8Array(await screenshot.arrayBuffer());
  const proofType = assertValidProofFile({ bytes });
  const proof = await uploadPaymentProof(orderId, { bytes }, proofType);
  const result = await submitPaymentClaim({
    orderId,
    reference,
    phone,
    proofPath: proof.path,
  });
  // Owner verification alert (client details + reference when given +
  // screenshot), after the response is on the wire — same after()
  // pattern as the order-placed notifications.
  const notify = () =>
    notifyPaymentClaimSubmitted({
      orderNumber: result.orderNumber,
      customer: result.customer,
      reference: reference.trim() === "" ? null : reference.trim().toUpperCase(),
      totalPaise: result.totalPaise,
      proofPath: proof.path,
    });
  try {
    after(notify);
  } catch {
    void notify();
  }
  return ok(result);
});
