import { contactConfig } from "@/config/contact";
import { sendContactQuery } from "@/lib/contact/notify";
import { validateContactQuery } from "@/lib/contact/validation";
import { withErrorHandling } from "@/lib/api/handler";
import { badRequest, fail, ok, unprocessable } from "@/lib/api/response";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";

/**
 * POST /api/contact — { name, phone?, message, company? } → query email.
 *
 * The visitor is never asked for an address: the query is validated
 * here and delivered to our own inbox (CONTACT_QUERY_EMAIL, default
 * bizwise.ops@gmail.com). Server authority: lengths, the optional
 * Indian mobile number and the honeypot all settle on this side, so
 * the mailer only ever sees normalized text.
 *
 * `company` is the honeypot — invisible to people, attractive to
 * bots. A filled one is accepted and dropped, which keeps the
 * responder quiet while the inbox stays clean.
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

  const { errors, value } = validateContactQuery({
    name: String(record["name"] ?? ""),
    phone: String(record["phone"] ?? ""),
    message: String(record["message"] ?? ""),
  });
  if (value === null) {
    return unprocessable("Please check the details below.", errors);
  }

  const result = await sendContactQuery(value);
  if (result.sent > 0) return ok({ queued: true });

  // Never claim success for a query the inbox did not receive — the
  // visitor still has a phone number on screen.
  const phone = contactConfig.phones[0]?.display;
  const fallback = phone
    ? `Please call ${phone} or email ${contactConfig.email}.`
    : `Please email ${contactConfig.email}.`;
  return fail(
    "QUERY_SEND_FAILED",
    `We could not send your query right now. ${fallback}`,
    { status: 502 },
  );
});
