import { contactConfig } from "@/config/contact";
import { sendResellerEnquiry } from "@/lib/resellers/notify";
import { validateResellerEnquiry } from "@/lib/resellers/validation";
import { withErrorHandling } from "@/lib/api/handler";
import { badRequest, fail, ok, unprocessable } from "@/lib/api/response";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";

/**
 * POST /api/resellers — { name, phone, business?, message, company? }
 * → reseller-enquiry email.
 *
 * Trade rates are not published per item, so resellers send their
 * requirements here and the sales team calls back. Phone is REQUIRED
 * (unlike the general contact form) — an enquiry with no callback
 * number goes nowhere. Shares the tight `contact` bucket (5/min,
 * fail-closed) and the same honeypot convention: `company` is the
 * hidden field — filled by bots, accepted and dropped.
 */
export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("contact", await checkRateLimit(req, "contact"));
  if (denied) return denied;

  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    return badRequest("Request body must be JSON.");
  }
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  if (String(record["company"] ?? "").trim() !== "") {
    return ok({ queued: true });
  }

  const { errors, value } = validateResellerEnquiry({
    name: String(record["name"] ?? ""),
    phone: String(record["phone"] ?? ""),
    business: String(record["business"] ?? ""),
    message: String(record["message"] ?? ""),
  });
  if (value === null) {
    return unprocessable("Please check the details below.", errors);
  }

  const result = await sendResellerEnquiry(value);
  if (result.sent > 0) return ok({ queued: true });

  // Never claim success for an enquiry the inbox did not receive —
  // the visitor still has a phone number on screen.
  const phone = contactConfig.phones[0]?.display;
  const fallback = phone
    ? `Please call ${phone} or email ${contactConfig.email}.`
    : `Please email ${contactConfig.email}.`;
  return fail(
    "ENQUIRY_SEND_FAILED",
    `We could not send your enquiry right now. ${fallback}`,
    { status: 502 },
  );
});
