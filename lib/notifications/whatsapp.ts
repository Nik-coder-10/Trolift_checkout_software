import "server-only";
import { logWarn } from "@/lib/observability/logger";

/**
 * WhatsApp sends for order notifications (server-only).
 *
 * Provider: Meta's WhatsApp Cloud API (Graph API). Authenticates with a
 * Bearer access token and sends approved template messages.
 *
 * Required env vars:
 *   WHATSAPP_PROVIDER=meta
 *   META_WHATSAPP_ACCESS_TOKEN
 *   META_WHATSAPP_PHONE_NUMBER_ID   (sender's phone number ID)
 *   META_WHATSAPP_TEMPLATE_NAME     (approved template name)
 *
 * Optional:
 *   META_WHATSAPP_API_VERSION       (default v21.0)
 *   META_WHATSAPP_TEMPLATE_LANGUAGE (default en)
 *
 * Sends never throw: a messaging outage must not fail an order that
 * the database already committed. Failures are returned so the caller
 * can log them with the order number.
 */

export type WhatsAppProvider = "meta" | "off";

export interface WhatsAppMessage {
  /** Recipient in any common Indian form; normalized internally. */
  to: string;
  body: string;
  /** Ordered template values, used only when a template is configured. */
  templateVariables?: string[];
}

export interface WhatsAppSendOutcome {
  to: string;
  status: "sent" | "failed" | "skipped";
  /** Meta message ID on success, or the failure reason. */
  detail?: string;
}

const DEFAULT_API_VERSION = "v21.0";
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_RETRIES = 2;

function env(key: string): string {
  return (process.env[key] ?? "").trim();
}

export function whatsappProvider(): WhatsAppProvider {
  const explicit = env("WHATSAPP_PROVIDER").toLowerCase();
  if (explicit === "off" || explicit === "none") return "off";
  if (explicit === "meta") return "meta";
  return metaAccessToken() !== "" && metaPhoneNumberId() !== ""
    ? "meta"
    : "off";
}

export function whatsappConfigured(): boolean {
  return whatsappProvider() !== "off";
}

function metaAccessToken(): string {
  return env("META_WHATSAPP_ACCESS_TOKEN");
}

function metaPhoneNumberId(): string {
  return env("META_WHATSAPP_PHONE_NUMBER_ID");
}

function metaApiVersion(): string {
  const v = env("META_WHATSAPP_API_VERSION");
  return v !== "" ? v : DEFAULT_API_VERSION;
}

function metaTemplateName(): string {
  return env("META_WHATSAPP_TEMPLATE_NAME");
}

function metaTemplateLanguage(): string {
  const lang = env("META_WHATSAPP_TEMPLATE_LANGUAGE");
  return lang !== "" ? lang : "en";
}

/**
 * Owner's WhatsApp number (Indian mobile). Unset means the owner copy
 * is skipped; a malformed value is logged and skipped rather than
 * silently sending nothing.
 */
export function ownerWhatsAppNumber(): string | null {
  const raw = env("WHATSAPP_OWNER_PHONE");
  if (raw === "") return null;
  const address = toWhatsAppAddress(raw);
  if (address === null) {
    logWarn("WHATSAPP_OWNER_PHONE is not a usable mobile number.", {
      category: "whatsapp",
      hint: "Use a 10-digit Indian mobile or full E.164 (e.g. +919876543210).",
    });
    return null;
  }
  return address;
}

/**
 * E.164 phone number for Meta's API. Accepts what the app stores
 * (`+919876543210`), a bare 10-digit Indian mobile (prefixed with 91),
 * the trunk-prefixed `098765 00000` form (leading zero dropped) and an
 * already-prefixed `whatsapp:+91…`. Returns null when the digits cannot
 * be a real number, so a bad value is skipped instead of throwing
 * mid-order.
 */
export function toWhatsAppAddress(value: string): string | null {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (digits === "") return null;
  const withoutTrunk =
    digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  const e164 =
    withoutTrunk.length === 10 ? `91${withoutTrunk}` : withoutTrunk;
  if (e164.length < 11 || e164.length > 15) return null;
  return `+${e164}`;
}

function messagesUrl(): string {
  const version = metaApiVersion();
  const phoneId = metaPhoneNumberId();
  return `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneId)}/messages`;
}

function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SendDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function sendWhatsAppMessages(
  messages: WhatsAppMessage[],
  deps?: SendDeps,
): Promise<WhatsAppSendOutcome[]> {
  const provider = whatsappProvider();
  if (provider === "off") {
    return messages.map((m) => ({
      to: m.to,
      status: "skipped" as const,
      detail: "WhatsApp provider is not configured.",
    }));
  }
  const token = metaAccessToken();
  const phoneId = metaPhoneNumberId();
  if (token === "" || phoneId === "") {
    return messages.map((m) => ({
      to: m.to,
      status: "skipped" as const,
      detail: "Meta WhatsApp credentials or phone number ID missing.",
    }));
  }
  const templateName = metaTemplateName();
  if (templateName === "") {
    return messages.map((m) => ({
      to: m.to,
      status: "skipped" as const,
      detail: "META_WHATSAPP_TEMPLATE_NAME is not set.",
    }));
  }

  const doFetch = deps?.fetchImpl ?? fetch;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = messagesUrl();

  return Promise.all(
    messages.map(async (message): Promise<WhatsAppSendOutcome> => {
      const recipient = toWhatsAppAddress(message.to);
      if (recipient === null) {
        return {
          to: message.to,
          status: "failed",
          detail: "Recipient number is not a usable mobile number.",
        };
      }

      const payload = buildMetaPayload(recipient, message, templateName);
      let lastError = "";

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const res = await doFetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(timeoutMs),
          });

          const text = await res.text().catch(() => "");
          const data = text ? JSON.parse(text) : null;

          if (res.ok) {
            const messageId =
              data?.messages?.[0]?.id ?? data?.message_id ?? "unknown";
            return { to: message.to, status: "sent", detail: messageId };
          }

          const errCode = data?.error?.code ?? 0;
          const errMsg = data?.error?.message ?? text;
          lastError = `Meta ${res.status}${errCode ? ` (code ${errCode})` : ""}: ${errMsg}`;

          if (!isTransient(res.status) || attempt === MAX_RETRIES) {
            return { to: message.to, status: "failed", detail: lastError };
          }

          await delay(300 * (attempt + 1));
        } catch (error) {
          lastError =
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : "unknown transport error";
          if (attempt === MAX_RETRIES) {
            return { to: message.to, status: "failed", detail: lastError };
          }
          await delay(300 * (attempt + 1));
        }
      }

      return { to: message.to, status: "failed", detail: lastError };
    }),
  );
}

function buildMetaPayload(
  recipient: string,
  message: WhatsAppMessage,
  templateName: string,
): Record<string, unknown> {
  const variables = message.templateVariables ?? [];
  return {
    messaging_product: "whatsapp",
    to: recipient,
    type: "template",
    template: {
      name: templateName,
      language: { code: metaTemplateLanguage() },
      components: [
        {
          type: "body",
          parameters: variables.map((text) => ({ type: "text", text })),
        },
      ],
    },
  };
}
