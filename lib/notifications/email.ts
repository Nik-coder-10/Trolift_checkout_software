import "server-only";
import nodemailer from "nodemailer";
import { logWarn } from "@/lib/observability/logger";

/**
 * Email notifications for order alerts (server-only).
 *
 * Provider: Gmail SMTP with an App Password. The sender authenticates
 * with a Gmail App Password (not the account password) — set one up at
 * https://myaccount.google.com/apppasswords after enabling 2FA.
 *
 * Required env vars:
 *   EMAIL_PROVIDER=smtp
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_USER=<gmail-address>
 *   SMTP_PASS=<gmail-app-password>
 *
 * Optional:
 *   EMAIL_FROM=<display name and address>
 *   ORDER_NOTIFICATION_EMAIL=<recipient for order alerts>
 *
 * Sends never throw: a notification outage must not fail an order that
 * the database already committed.
 */

export type EmailProvider = "smtp" | "off";

export interface EmailAttachment {
  filename: string;
  /** Raw bytes of the attachment (e.g. a PNG QR code). */
  content: Buffer;
  contentType: string;
  /** Optional CID for inline embedding in HTML bodies. */
  cid?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  attachments?: EmailAttachment[];
}

export interface EmailSendOutcome {
  to: string;
  status: "sent" | "failed" | "skipped";
  detail?: string;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 2;

function env(key: string): string {
  return (process.env[key] ?? "").trim();
}

export function emailProvider(): EmailProvider {
  const explicit = env("EMAIL_PROVIDER").toLowerCase();
  if (explicit === "off" || explicit === "none") return "off";
  if (explicit === "smtp") return "smtp";
  return smtpUser() !== "" && smtpPass() !== "" ? "smtp" : "off";
}

export function emailConfigured(): boolean {
  return emailProvider() !== "off";
}

function smtpHost(): string {
  return env("SMTP_HOST") || "smtp.gmail.com";
}

function smtpPort(): number {
  const p = Number(env("SMTP_PORT"));
  return Number.isFinite(p) && p > 0 ? p : 587;
}

function smtpUser(): string {
  return env("SMTP_USER");
}

function smtpPass(): string {
  return env("SMTP_PASS");
}

function emailFrom(): string {
  return env("EMAIL_FROM") || smtpUser();
}

function orderNotificationEmail(): string {
  return env("ORDER_NOTIFICATION_EMAIL");
}

function isTransient(error: unknown): boolean {
  if (!(error && typeof error === "object" && "code" in error)) return false;
  const code = String((error as { code: unknown }).code);
  return code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ENOTFOUND" || code.startsWith("421") || code.startsWith("450");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SendMailPayload {
  from: string;
  to: string;
  subject: string;
  text: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
    cid?: string;
  }>;
}

interface SendDeps {
  sendMail?: (msg: SendMailPayload) => Promise<unknown>;
  timeoutMs?: number;
}

export async function sendEmailMessages(
  messages: EmailMessage[],
  deps?: SendDeps,
): Promise<EmailSendOutcome[]> {
  const provider = emailProvider();
  if (provider === "off") {
    return messages.map((m) => ({
      to: m.to,
      status: "skipped" as const,
      detail: "Email provider is not configured.",
    }));
  }

  const user = smtpUser();
  const pass = smtpPass();
  if (user === "" || pass === "") {
    return messages.map((m) => ({
      to: m.to,
      status: "skipped" as const,
      detail: "SMTP credentials missing.",
    }));
  }

  const from = emailFrom();
  const sendMail = deps?.sendMail ?? ((msg: SendMailPayload) => {
    const transporter = nodemailer.createTransport({
      host: smtpHost(),
      port: smtpPort(),
      secure: smtpPort() === 465,
      auth: { user, pass },
      connectionTimeout: deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    return transporter.sendMail(msg);
  });

  return Promise.all(
    messages.map(async (message): Promise<EmailSendOutcome> => {
      let lastError = "";

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const payload: SendMailPayload = {
            from,
            to: message.to,
            subject: message.subject,
            text: message.body,
          };
          if (message.attachments && message.attachments.length > 0) {
            payload.attachments = message.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentType: a.contentType,
              ...(a.cid ? { cid: a.cid } : {}),
            }));
          }
          await sendMail(payload);
          return { to: message.to, status: "sent", detail: "delivered" };
        } catch (error) {
          lastError =
            error && typeof error === "object" && "message" in error
              ? String((error as { message: unknown }).message)
              : "unknown error";
          if (!isTransient(error) || attempt === MAX_RETRIES) {
            return { to: message.to, status: "failed", detail: lastError };
          }
          await delay(300 * (attempt + 1));
        }
      }

      return { to: message.to, status: "failed", detail: lastError };
    }),
  );
}

export function getOrderNotificationRecipient(): string | null {
  const raw = orderNotificationEmail();
  if (raw === "") return null;
  const trimmed = raw.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    logWarn("ORDER_NOTIFICATION_EMAIL is not a valid email address.", {
      category: "email",
      hint: "Set ORDER_NOTIFICATION_EMAIL to a valid email address.",
    });
    return null;
  }
  return trimmed;
}
