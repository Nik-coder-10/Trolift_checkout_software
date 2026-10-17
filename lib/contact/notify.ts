import "server-only";
import { contactConfig } from "@/config/contact";
import { logInfo, logWarn } from "@/lib/observability/logger";
import { emailConfigured, sendEmailMessages } from "@/lib/notifications/email";
import type { ValidContactQuery } from "@/lib/contact/validation";

/**
 * Contact-form delivery: the visitor's query becomes one email to our
 * own inbox. The visitor never supplies an address, so the message
 * carries their callback number and the body says explicitly that
 * there is no reply-to — we call them back.
 *
 * Sends never throw: an SMTP outage must surface as a failed outcome
 * (the route then tells the visitor to call us), never as a 500.
 */

/** Used when CONTACT_QUERY_EMAIL is unset or malformed. */
export const DEFAULT_CONTACT_QUERY_EMAIL = contactConfig.email;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function contactQueryRecipient(): string {
  const override = (process.env.CONTACT_QUERY_EMAIL ?? "").trim();
  if (override === "") return DEFAULT_CONTACT_QUERY_EMAIL;
  if (!EMAIL_SHAPE.test(override)) {
    logWarn("CONTACT_QUERY_EMAIL is not a valid email address — using the default inbox.", {
      category: "email",
      operation: "contact-query",
      hint: "Set CONTACT_QUERY_EMAIL to a valid address, or unset it.",
    });
    return DEFAULT_CONTACT_QUERY_EMAIL;
  }
  return override;
}

export interface ContactQueryMessage {
  subject: string;
  body: string;
}

export function buildContactQueryMessage(
  input: ValidContactQuery,
  receivedAt: Date = new Date(),
): ContactQueryMessage {
  const phoneLine =
    input.phone === null
      ? "Not provided — the visitor left no callback number."
      : input.phone;
  return {
    subject: `Website query from ${input.name}`,
    body: [
      "Website query — Trolift contact form",
      `Received: ${receivedAt.toISOString()}`,
      "",
      `Name: ${input.name}`,
      `Phone: ${phoneLine}`,
      "Email: not collected by the form (there is no reply-to address).",
      "",
      "Message:",
      input.message,
      "",
      "— Sent from the contact form on the Trolift website.",
    ].join("\n"),
  };
}

export interface ContactQueryOutcome {
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

export async function sendContactQuery(
  input: ValidContactQuery,
  deps?: NotifyDeps,
): Promise<ContactQueryOutcome> {
  const recipient = contactQueryRecipient();
  if (!emailConfigured()) {
    logWarn("Contact query accepted but email provider is not configured.", {
      category: "email",
      operation: "contact-query",
      hint: "Set SMTP_USER/SMTP_PASS to deliver contact queries.",
    });
    return { sent: 0, failed: 0, skipped: 1 };
  }

  const { subject, body } = buildContactQueryMessage(input);
  const outcomes = await sendEmailMessages([{ to: recipient, subject, body }], deps);
  const outcome = outcomes[0];

  if (outcome?.status === "sent") {
    logInfo("Contact query email sent.", {
      category: "email",
      operation: "contact-query",
      to: recipient,
    });
    return { sent: 1, failed: 0, skipped: 0 };
  }
  if (outcome?.status === "failed") {
    logWarn("Contact query email failed.", {
      category: "email",
      operation: "contact-query",
      reason: outcome.detail ?? "unknown",
    });
    return { sent: 0, failed: 1, skipped: 0 };
  }
  return { sent: 0, failed: 0, skipped: 1 };
}
