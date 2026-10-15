import "server-only";
import { logWarn } from "@/lib/observability/logger";

/**
 * WhatsApp sends for order notifications (server-only).
 *
 * Provider: Twilio's Messages API (`TWILIO_ACCOUNT_SID`,
 * `TWILIO_AUTH_TOKEN`, sender in `TWILIO_WHATSAPP_FROM` or
 * `TWILIO_PHONE_NUMBER`). `WHATSAPP_PROVIDER=off` disables messaging;
 * the default `auto` enables it only when credentials AND a sender are
 * present, so an unconfigured deployment logs a warning instead of
 * failing every order.
 *
 * Two sending modes, because WhatsApp's policy requires an approved
 * template for business-initiated messages (a customer who never
 * messaged us first is outside the 24-hour service window):
 *   - `TWILIO_WHATSAPP_TEMPLATE_SID` set → the approved utility
 *     template is sent with ordered variables ({{1}}, {{2}}, …).
 *   - unset → a plain text message. That works in the Twilio sandbox
 *     and inside the open service window, and Twilio rejects it
 *     (error 63016) outside it — which we log, never retry blindly.
 *
 * Sends never throw: a messaging outage must not fail an order that
 * the database already committed. Failures are returned so the caller
 * can log them with the order number.
 */

export type WhatsAppProvider = "twilio" | "off";

export interface WhatsAppMessage {
  /** Recipient in any common Indian form; normalized internally. */
  to: string;
  body: string;
  /** Ordered template values, used only when a template SID is set. */
  templateVariables?: string[];
}

export interface WhatsAppSendOutcome {
  to: string;
  status: "sent" | "failed" | "skipped";
  /** Twilio message SID on success, or the failure reason. */
  detail?: string;
}

/** Twilio REST endpoint for sending a message from an account. */
const TWILIO_MESSAGES_URL = (accountSid: string): string =>
  `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;

const DEFAULT_TIMEOUT_MS = 8_000;

function env(key: string): string {
  return (process.env[key] ?? "").trim();
}

function twilioAccountSid(): string {
  return env("TWILIO_ACCOUNT_SID");
}

function twilioAuthToken(): string {
  return env("TWILIO_AUTH_TOKEN");
}

/** Configured WhatsApp sender, with or without the `whatsapp:` prefix. */
export function whatsappSender(): string | null {
  return toWhatsAppAddress(env("TWILIO_WHATSAPP_FROM") || env("TWILIO_PHONE_NUMBER"));
}

export function whatsappTemplateSid(): string | null {
  return env("TWILIO_WHATSAPP_TEMPLATE_SID") || null;
}

export function whatsappProvider(): WhatsAppProvider {
  const explicit = env("WHATSAPP_PROVIDER").toLowerCase();
  if (explicit === "off" || explicit === "none") return "off";
  if (explicit === "twilio") return "twilio";
  // auto: on only when the credentials a send actually needs exist.
  return twilioAccountSid() !== "" &&
    twilioAuthToken() !== "" &&
    whatsappSender() !== null
    ? "twilio"
    : "off";
}

export function whatsappConfigured(): boolean {
  return whatsappProvider() !== "off";
}

/**
 * Owner's WhatsApp number (Indian mobile). Unset means the owner copy
 * is skipped; a malformed value is logged and skipped rather than
 * silently sending nothing.
 */
export function ownerWhatsAppNumber(): string | null {
  const raw = env("OWNER_WHATSAPP_NUMBER");
  if (raw === "") return null;
  const address = toWhatsAppAddress(raw);
  if (address === null) {
    logWarn("OWNER_WHATSAPP_NUMBER is not a usable mobile number.", {
      category: "whatsapp",
      hint: "Use a 10-digit Indian mobile or full E.164 (e.g. +919876543210).",
    });
    return null;
  }
  return address;
}

/**
 * WhatsApp address for a phone number: `whatsapp:+<E.164>`. Accepts
 * what the app stores (`+919876543210`), a bare 10-digit Indian mobile
 * (prefixed with 91), the trunk-prefixed `098765 00000` form (leading
 * zero dropped) and an already-prefixed `whatsapp:+91…`. Returns null
 * when the digits cannot be a real number, so a bad value is skipped
 * instead of throwing mid-order.
 */
export function toWhatsAppAddress(value: string): string | null {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (digits === "") return null;
  // National trunk prefix (0) on a 10-digit mobile — never part of E.164.
  const withoutTrunk =
    digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  const e164 =
    withoutTrunk.length === 10 ? `91${withoutTrunk}` : withoutTrunk;
  if (e164.length < 11 || e164.length > 15) return null;
  return `whatsapp:+${e164}`;
}

interface SendDeps {
  /** Injectable for tests — defaults to global fetch. */
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
  const accountSid = twilioAccountSid();
  const authToken = twilioAuthToken();
  const sender = whatsappSender();
  if (accountSid === "" || authToken === "" || sender === null) {
    return messages.map((m) => ({
      to: m.to,
      status: "skipped" as const,
      detail: "Twilio credentials or sender missing.",
    }));
  }
  const templateSid = whatsappTemplateSid();
  const doFetch = deps?.fetchImpl ?? fetch;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  const url = TWILIO_MESSAGES_URL(accountSid);

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
      const params = new URLSearchParams({ From: sender, To: recipient });
      if (templateSid !== null && message.templateVariables?.length) {
        params.set("ContentSid", templateSid);
        params.set(
          "ContentVariables",
          JSON.stringify(
            Object.fromEntries(
              message.templateVariables.map((value, index) => [
                String(index + 1),
                value,
              ]),
            ),
          ),
        );
      } else {
        params.set("Body", message.body);
      }
      try {
        const res = await doFetch(url, {
          method: "POST",
          headers: {
            Authorization: authorization,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params.toString(),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const payload = (await res.json().catch(() => null)) as
          | { sid?: string; code?: number; message?: string }
          | null;
        if (!res.ok) {
          return {
            to: message.to,
            status: "failed",
            detail: `Twilio ${res.status}${
              payload?.code ? ` (code ${payload.code})` : ""
            }: ${payload?.message ?? "send rejected"}`,
          };
        }
        return { to: message.to, status: "sent", detail: payload?.sid };
      } catch (error) {
        return {
          to: message.to,
          status: "failed",
          detail:
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : "unknown transport error",
        };
      }
    }),
  );
}
