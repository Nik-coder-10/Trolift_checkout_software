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
import { DEFAULT_CONTACT_QUERY_EMAIL } from "@/lib/contact/notify";
import {
  RESELLER_MESSAGE_MAX,
  RESELLER_MESSAGE_MIN,
  validateResellerEnquiry,
} from "@/lib/resellers/validation";
import {
  buildResellerEnquiryMessage,
  sendResellerEnquiry,
} from "@/lib/resellers/notify";
import { emailConfigured, sendEmailMessages } from "@/lib/notifications/email";
import { resetRateLimits, routeLimit } from "@/lib/rate-limit/index";
import { POST } from "@/app/api/resellers/route";

const REPO = join(__dirname, "..");
const repoFile = (rel: string) => readFileSync(join(REPO, rel), "utf8");

const REQUIREMENTS =
  "Need 5 telescopic ladders monthly for our Pune + Mumbai branches. GSTIN 27ABCDE1234F1Z0.";

const VALID = {
  name: "Ravi Kumar",
  phone: "9876543210",
  business: "Kumar Trading Co.",
  message: REQUIREMENTS,
};

function post(body: unknown, headers?: Record<string, string>): Promise<Response> {
  return POST(
    new Request("http://localhost:3000/api/resellers", {
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

describe("validateResellerEnquiry", () => {
  it("accepts an enquiry, collapsing the name and normalizing the phone", () => {
    const { errors, value } = validateResellerEnquiry({
      name: "  Ravi   Kumar \n",
      phone: "98765 43210",
      business: " Kumar  Trading ",
      message: REQUIREMENTS,
    });
    expect(errors).toEqual({});
    expect(value).toEqual({
      name: "Ravi Kumar",
      phone: "+919876543210",
      business: "Kumar Trading",
      message: REQUIREMENTS,
    });
  });

  it("REQUIRES a phone — unlike the general contact form", () => {
    const { errors, value } = validateResellerEnquiry({ ...VALID, phone: "" });
    expect(value).toBeNull();
    expect(errors.phone).toBeTruthy();
  });

  it("treats a blank business name as no business, not an error", () => {
    const { errors, value } = validateResellerEnquiry({ ...VALID, business: "" });
    expect(errors).toEqual({});
    expect(value?.business).toBeNull();
  });

  it.each([
    ["name", { ...VALID, name: "A" }],
    ["name", { ...VALID, name: "x".repeat(101) }],
    ["phone", { ...VALID, phone: "12345" }],
    ["phone", { ...VALID, phone: "0000000000" }],
    ["message", { ...VALID, message: "too short" }],
    ["message", { ...VALID, message: "x".repeat(RESELLER_MESSAGE_MAX + 1) }],
  ])("rejects a bad %s", (field, input) => {
    const { errors, value } = validateResellerEnquiry(input as typeof VALID);
    expect(value).toBeNull();
    expect(errors[field as "name" | "phone" | "message"]).toBeTruthy();
  });

  it("sets a message floor high enough to capture real requirements", () => {
    expect(RESELLER_MESSAGE_MIN).toBeGreaterThanOrEqual(15);
  });
});

describe("reseller enquiry email", () => {
  it("uses a distinct subject so trade enquiries are filterable", () => {
    const { subject, body } = buildResellerEnquiryMessage(
      {
        name: "Ravi Kumar",
        phone: "+919876543210",
        business: "Kumar Trading Co.",
        message: REQUIREMENTS,
      },
      new Date("2026-10-19T09:30:00.000Z"),
    );
    expect(subject).toBe("Reseller enquiry from Ravi Kumar");
    expect(body).toContain("Received: 2026-10-19T09:30:00.000Z");
    expect(body).toContain("Phone: +919876543210");
    expect(body).toContain("Business: Kumar Trading Co.");
    expect(body).toContain("Email: not collected by the form");
    expect(body).toContain(REQUIREMENTS);
  });

  it("says when no business name was left", () => {
    const { body } = buildResellerEnquiryMessage({
      name: "Ravi Kumar",
      phone: "+919876543210",
      business: null,
      message: REQUIREMENTS,
    });
    expect(body).toContain("Business: Not provided.");
  });

  it("shares the contact inbox override", () => {
    process.env.CONTACT_QUERY_EMAIL = "trade@trolift.example";
    // sendResellerEnquiry resolves the recipient through the same
    // contactQueryRecipient() the contact form uses — verified via the
    // delivered message below.
    return sendResellerEnquiry({
      name: "Ravi Kumar",
      phone: "+919876543210",
      business: null,
      message: REQUIREMENTS,
    }).then(() => {
      const [messages] = vi.mocked(sendEmailMessages).mock.calls[0]!;
      expect(messages[0]!.to).toBe("trade@trolift.example");
    });
  });

  it("delivers the enquiry to the configured inbox", async () => {
    const result = await sendResellerEnquiry({
      name: "Ravi Kumar",
      phone: "+919876543210",
      business: "Kumar Trading Co.",
      message: REQUIREMENTS,
    });
    expect(result).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sendEmailMessages).toHaveBeenCalledTimes(1);
    const [messages] = vi.mocked(sendEmailMessages).mock.calls[0]!;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.subject).toBe("Reseller enquiry from Ravi Kumar");
    expect(messages[0]!.body).toContain(REQUIREMENTS);
  });

  it("reports a skipped send when no email provider is configured", async () => {
    vi.mocked(emailConfigured).mockReturnValue(false);
    const result = await sendResellerEnquiry({
      name: "Ravi Kumar",
      phone: "+919876543210",
      business: null,
      message: REQUIREMENTS,
    });
    expect(result).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(sendEmailMessages).not.toHaveBeenCalled();
  });
});

describe("POST /api/resellers", () => {
  it("delivers a valid enquiry and answers queued", async () => {
    const res = await post(VALID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { queued: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data.queued).toBe(true);
    expect(sendEmailMessages).toHaveBeenCalledTimes(1);
  });

  it("rejects a bad payload with per-field errors and sends nothing", async () => {
    const res = await post({ name: "A", phone: "", message: "short" });
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

  it("rejects a missing phone even with everything else valid", async () => {
    const res = await post({ ...VALID, phone: "" });
    expect(res.status).toBe(422);
    expect(sendEmailMessages).not.toHaveBeenCalled();
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

  it("never claims success when the inbox did not receive the enquiry", async () => {
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
    expect(body.error.code).toBe("ENQUIRY_SEND_FAILED");
    expect(body.error.message).toContain(contactConfig.phones[0]!.display);
    expect(body.error.message).toContain(contactConfig.email);
  });

  it("rejects a cross-origin submission before the route runs", async () => {
    const res = await post(VALID, { Origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(sendEmailMessages).not.toHaveBeenCalled();
  });

  it("shares the tight contact rate-limit bucket", async () => {
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

describe("reseller page contract (source)", () => {
  it("frames the page around trade rates that are not published", () => {
    const page = repoFile(join("app", "resellers", "page.tsx"));
    expect(page).toContain("Are you a reseller?");
    expect(page).toContain("do not publish trade rates");
    expect(page).toContain("ResellerForm");
    expect(page).toContain("contactConfig.phones.map");
  });

  it("collects requirements with no email field and posts to /api/resellers", () => {
    const form = repoFile(join("components", "resellers", "ResellerForm.tsx"));
    expect(form).toContain('fetch("/api/resellers"');
    expect(form).not.toContain('type="email"');
    expect(form).not.toContain('name="email"');
    expect(form).toContain('name="message"');
    expect(form).toContain('name="phone"');
    expect(form).toContain('name="business"');
    // Honeypot stays invisible to people.
    expect(form).toContain('name="company"');
    expect(form).toContain('className="hidden"');
  });

  it("replaces the navbar Get a Quote CTA with the reseller page", () => {
    const navbar = repoFile(join("components", "layout", "Navbar.tsx"));
    expect(navbar).toContain('href="/resellers"');
    expect(navbar).toContain("Resellers");
    expect(navbar).not.toContain("Get a Quote");
    const footer = repoFile(join("components", "layout", "Footer.tsx"));
    expect(footer).toContain('href="/resellers"');
    const sitemap = repoFile(join("app", "sitemap.ts"));
    expect(sitemap).toContain("`${base}/resellers`");
  });
});
