import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/notifications/email", () => ({
  emailProvider: vi.fn(() => "smtp"),
  emailConfigured: vi.fn(() => true),
  getOrderNotificationRecipient: vi.fn(() => null),
  sendEmailMessages: vi.fn(async () => [
    { to: "bizwise.ops@gmail.com", status: "sent", detail: "delivered" },
  ]),
}));

import { contactConfig } from "@/config/contact";
import { validateContactQuery } from "@/lib/contact/validation";
import {
  DEFAULT_CONTACT_QUERY_EMAIL,
  buildContactQueryMessage,
  contactQueryRecipient,
  sendContactQuery,
} from "@/lib/contact/notify";
import { emailConfigured, sendEmailMessages } from "@/lib/notifications/email";
import { resetRateLimits, routeLimit } from "@/lib/rate-limit/index";
import { POST } from "@/app/api/contact/route";

const REPO = join(__dirname, "..");
const repoFile = (rel: string) => readFileSync(join(REPO, rel), "utf8");

const VALID = {
  name: "Anita Sharma",
  phone: "9876543210",
  message: "Please quote 2 units of the 20 ft telescopic ladder for Pune 411014.",
};

function post(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return POST(
    new Request("http://localhost:3000/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  resetRateLimits();
  delete process.env.CONTACT_QUERY_EMAIL;
  vi.mocked(emailConfigured).mockReturnValue(true);
  vi.mocked(sendEmailMessages).mockClear();
  vi.mocked(sendEmailMessages).mockResolvedValue([
    { to: DEFAULT_CONTACT_QUERY_EMAIL, status: "sent", detail: "delivered" },
  ]);
});

describe("contact details (the published numbers)", () => {
  it("carries all three call lines in dialable and display form", () => {
    expect(contactConfig.phones.map((p) => p.tel)).toEqual([
      "+919119185993",
      "+918690870788",
      "+918690800788",
    ]);
    expect(contactConfig.phones.map((p) => p.display)).toEqual([
      "+91 9119185993",
      "+91 8690870788",
      "+91 8690800788",
    ]);
  });

  it("publishes the ops inbox for form queries", () => {
    expect(contactConfig.email).toBe("bizwise.ops@gmail.com");
    expect(contactQueryRecipient()).toBe("bizwise.ops@gmail.com");
  });

  it("gives every line a tel: href a phone dialer understands", () => {
    for (const line of contactConfig.phones) {
      expect(line.tel).toMatch(/^\+91[6-9]\d{9}$/);
      expect(line.display.replace(/\s/g, "")).toBe(line.tel);
    }
  });
});

describe("validateContactQuery", () => {
  it("accepts a query, collapsing the name and normalizing the phone", () => {
    const { errors, value } = validateContactQuery({
      name: "  Anita   Sharma \n",
      phone: "98765 43210",
      message: VALID.message,
    });
    expect(errors).toEqual({});
    expect(value).toEqual({
      name: "Anita Sharma",
      phone: "+919876543210",
      message: VALID.message,
    });
  });

  it("treats a blank phone as no callback number, not an error", () => {
    const { errors, value } = validateContactQuery({ ...VALID, phone: "" });
    expect(errors).toEqual({});
    expect(value?.phone).toBeNull();
  });

  it.each([
    ["name", { ...VALID, name: "A" }],
    ["name", { ...VALID, name: "x".repeat(101) }],
    ["phone", { ...VALID, phone: "12345" }],
    ["phone", { ...VALID, phone: "0000000000" }],
    ["message", { ...VALID, message: "too short" }],
    ["message", { ...VALID, message: "x".repeat(2001) }],
  ])("rejects a bad %s", (field, input) => {
    const { errors, value } = validateContactQuery(input as typeof VALID);
    expect(value).toBeNull();
    expect(errors[field as "name" | "phone" | "message"]).toBeTruthy();
  });
});

describe("contact query email", () => {
  it("overrides the inbox through CONTACT_QUERY_EMAIL", () => {
    process.env.CONTACT_QUERY_EMAIL = "sales@trolift.example";
    expect(contactQueryRecipient()).toBe("sales@trolift.example");
  });

  it("falls back to the default inbox when the override is malformed", () => {
    process.env.CONTACT_QUERY_EMAIL = "not-an-email";
    expect(contactQueryRecipient()).toBe(DEFAULT_CONTACT_QUERY_EMAIL);
  });

  it("says who is calling and that there is no reply-to address", () => {
    const { subject, body } = buildContactQueryMessage(
      { name: "Anita Sharma", phone: "+919876543210", message: "Need 3 trolleys." },
      new Date("2026-10-17T09:30:00.000Z"),
    );
    expect(subject).toBe("Website query from Anita Sharma");
    expect(body).toContain("Received: 2026-10-17T09:30:00.000Z");
    expect(body).toContain("Phone: +919876543210");
    expect(body).toContain("Email: not collected by the form");
    expect(body).toContain("Need 3 trolleys.");
  });

  it("flags a query that left no number", () => {
    const { body } = buildContactQueryMessage({
      name: "Ravi Kumar",
      phone: null,
      message: "Please call me back about pricing.",
    });
    expect(body).toContain("Not provided");
    expect(body).toContain("Please call me back about pricing.");
  });

  it("delivers the query to the configured inbox", async () => {
    const result = await sendContactQuery({
      name: "Anita Sharma",
      phone: "+919876543210",
      message: VALID.message,
    });
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sendEmailMessages).toHaveBeenCalledTimes(1);
    const [messages] = vi.mocked(sendEmailMessages).mock.calls[0]!;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.to).toBe("bizwise.ops@gmail.com");
    expect(messages[0]!.subject).toBe("Website query from Anita Sharma");
    expect(messages[0]!.body).toContain(VALID.message);
  });

  it("reports a skipped send when no email provider is configured", async () => {
    vi.mocked(emailConfigured).mockReturnValue(false);
    const result = await sendContactQuery({
      name: "Anita Sharma",
      phone: null,
      message: VALID.message,
    });
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(sendEmailMessages).not.toHaveBeenCalled();
  });
});

describe("POST /api/contact", () => {
  it("delivers a valid query and answers queued", async () => {
    const res = await post(VALID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { queued: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data.queued).toBe(true);
    expect(sendEmailMessages).toHaveBeenCalledTimes(1);
  });

  it("rejects a bad payload with per-field errors and sends nothing", async () => {
    const res = await post({ name: "A", phone: "12345", message: "short" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; details: Record<string, string> };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.name).toBeTruthy();
    expect(body.error.details.phone).toBeTruthy();
    expect(body.error.details.message).toBeTruthy();
    expect(sendEmailMessages).not.toHaveBeenCalled();
  });

  it("accepts a JSON object with the fields as strings only", async () => {
    const res = await post({ name: 42, phone: null, message: VALID.message });
    // String(42) = "42" is a valid name, null phone means "not provided".
    expect(res.status).toBe(200);
  });

  it("answers a non-JSON body with a clear 400", async () => {
    const res = await post("not-json");
    expect(res.status).toBe(400);
    expect(sendEmailMessages).not.toHaveBeenCalled();
  });

  it("drops a honeypot submission without emailing anyone", async () => {
    const res = await post({ ...VALID, company: "Totally Real Ltd" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { queued: boolean } };
    expect(body.data.queued).toBe(true);
    expect(sendEmailMessages).not.toHaveBeenCalled();
  });

  it("never claims success when the inbox did not receive the query", async () => {
    vi.mocked(sendEmailMessages).mockResolvedValue([
      { to: DEFAULT_CONTACT_QUERY_EMAIL, status: "failed", detail: "SMTP down" },
    ]);
    const res = await post(VALID);
    expect(res.status).toBe(502);
    const body = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("QUERY_SEND_FAILED");
    // The visitor is handed the real fallback channels.
    expect(body.error.message).toContain(contactConfig.phones[0]!.display);
    expect(body.error.message).toContain(contactConfig.email);
  });

  it("rejects a cross-origin submission before the route runs", async () => {
    const res = await post(VALID, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(sendEmailMessages).not.toHaveBeenCalled();
  });

  it("rate-limits a query flood, then answers 429 with Retry-After", async () => {
    const limit = routeLimit("contact").limit;
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(20);
    for (let i = 0; i < limit; i++) {
      expect((await post(VALID)).status).toBe(200);
    }
    const denied = await post(VALID);
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toMatch(/^\d+$/);
  });
});

describe("contact page contract (source)", () => {
  it("renders one tel: call button per published line", () => {
    const page = repoFile(join("app", "contact", "page.tsx"));
    expect(page).toContain("contactConfig.phones.map");
    expect(page).toContain("href={`tel:${line.tel}`}");
    expect(page).toContain("contactConfig.email");
  });

  it("collects a query with no email field of any kind", () => {
    const form = repoFile(join("components", "contact", "QueryForm.tsx"));
    expect(form).toContain('fetch("/api/contact"');
    expect(form).not.toContain('type="email"');
    expect(form).not.toContain('name="email"');
    expect(form).toContain('name="message"');
    expect(form).toContain('name="phone"');
    // Honeypot stays invisible to people.
    expect(form).toContain('name="company"');
    expect(form).toContain('className="hidden"');
  });

  it("keeps the site's contact entry points pointed at /contact", () => {
    const navbar = repoFile(join("components", "layout", "Navbar.tsx"));
    expect(navbar).toContain('{ label: "Contact", href: "/contact" }');
    expect(navbar).not.toContain('"/#contact"');
    const footer = repoFile(join("components", "layout", "Footer.tsx"));
    expect(footer).toContain('["Contact sales", "/contact"]');
    const sitemap = repoFile(join("app", "sitemap.ts"));
    expect(sitemap).toContain("`${base}/contact`");
  });
});
