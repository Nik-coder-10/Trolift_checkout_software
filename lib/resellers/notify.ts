import "server-only";
import { contactQueryRecipient } from "@/lib/contact/notify";
import { logInfo, logWarn } from "@/lib/observability/logger";
import { emailConfigured, sendEmailMessages } from "@/lib/notifications/email";
import type { ValidResellerEnquiry } from "@/lib/resellers/validation";

/**
 * Reseller-enquiry delivery: the requirements become one email to the
 * sales inbox (same recipient override as the contact form —
 * CONTACT_QUERY_EMAIL). The subject is distinct so trade enquiries can
 * be filtered from ordinary queries at a glance.
 *
 * Sends never throw: an SMTP outage must surface as a failed outcome
 * (the route then tells the visitor to call us), never as a 500.
 */

export interface ResellerEnquiryMessage {
  subject: string;
  body: string;
}

export function buildResellerEnquiryMessage(
  input: ValidResellerEnquiry,
  receivedAt: Date = new Date(),
): ResellerEnquiryMessage {
  return {
    subject: `Reseller enquiry from ${input.name}`,
    body: [
      "Reseller enquiry — Trolift website",
      `Received: ${receivedAt.toISOString()}`,
      "",
      `Name: ${input.name}`,
      `Phone: ${input.phone}`,
      `Business: ${input.business ?? "Not provided."}`,
      "Email: not collected by the form (there is no reply-to address).",
      "",
      "Requirements:",
      input.message,
      "",
      "— Sent from the reseller page on the Trolift website.",
    ].join("\n"),
  };
}

export interface ResellerEnquiryOutcome {
  sent: number;
  failed: number;
  skipped: number;
}

interface NotifyDeps {
  sendMail?: (msg: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }) => Promise<unknown>;
}

export async function sendResellerEnquiry(
  input: ValidResellerEnquiry,
  deps?: NotifyDeps,
): Promise<ResellerEnquiryOutcome> {
  const recipient = contactQueryRecipient();
  if (!emailConfigured()) {
    logWarn("Reseller enquiry accepted but email provider is not configured.", {
      category: "email",
      operation: "reseller-enquiry",
      hint: "Set SMTP_USER/SMTP_PASS to deliver reseller enquiries.",
    });
    return { sent: 0, failed: 0, skipped: 1 };
  }

  const { subject, body } = buildResellerEnquiryMessage(input);
  const outcomes = await sendEmailMessages([{ to: recipient, subject, body }], deps);
  const outcome = outcomes[0];

  if (outcome?.status === "sent") {
    logInfo("Reseller enquiry email sent.", {
      category: "email",
      operation: "reseller-enquiry",
      to: recipient,
    });
    return { sent: 1, failed: 0, skipped: 0 };
  }
  if (outcome?.status === "failed") {
    logWarn("Reseller enquiry email failed.", {
      category: "email",
      operation: "reseller-enquiry",
      reason: outcome.detail ?? "unknown",
    });
    return { sent: 0, failed: 1, skipped: 0 };
  }
  return { sent: 0, failed: 0, skipped: 1 };
}
