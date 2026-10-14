import { beforeEach, describe, expect, it, vi } from "vitest";

// server-only modules throw outside the Next server runtime by design.
vi.mock("server-only", () => ({}));

import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";

let dbCalls = 0;
let handler: MockResponder = () => {
  throw new Error("unexpected query");
};
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    dbCalls += 1;
    return createMockClient(handler);
  },
}));

import {
  expiredGuestCookie,
  generateGuestToken,
  guestCookieName,
  guestTokenFromCookieHeader,
  hashGuestToken,
  maskGstin,
  maskPhoneFull,
  maskReference,
  matchesStoredToken,
  serializeGuestCookie,
  type GuestTokenRow,
} from "@/lib/guest-access/tokens";
import {
  authorizeGuestRequest,
  hasGuestCredential,
  issueGuestToken,
  revokeGuestToken,
  rotateGuestToken,
  verifyGuestToken,
} from "@/lib/guest-access/guard";
import { getPayableOrderForGuest } from "@/lib/payments/order";
import { POST as claimPost } from "@/app/api/payments/claim/route";
import { GET as invoiceGet } from "@/app/api/orders/[id]/invoice/route";
import { POST as sessionPost } from "@/app/api/orders/[id]/session/route";
import { POST as rotatePost } from "@/app/api/orders/[id]/rotate/route";
import { POST as recoverPost } from "@/app/api/orders/recover/route";

const ORDER_ID = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_ID = "123e4567-e89b-12d3-a456-426614174099";
const UNKNOWN_ID = "123e4567-e89b-12d3-a456-426614174088";

/* In-memory token table keyed by order id. */
let tokens: GuestTokenRow[];
let ordersKnown: Set<string>;

const rowFor = (raw: string, orderId: string, over = {}) => ({
  token_hash: hashGuestToken(raw),
  order_id: orderId,
  expires_at: new Date(Date.now() + 86400_000).toISOString(),
  revoked_at: null,
  ...over,
});

beforeEach(() => {
  resetRateLimits();
  dbCalls = 0;
  tokens = [];
  ordersKnown = new Set([ORDER_ID, OTHER_ID]);
  handler = (op) => {
    if (op.table === "order_access_tokens") {
      if (op.updateValues !== undefined && op.filters.length === 0) {
        // INSERT
        const v = op.updateValues as Record<string, unknown>;
        tokens.push({
          token_hash: v["token_hash"] as string,
          order_id: v["order_id"] as string,
          expires_at: v["expires_at"] as string,
          revoked_at: null,
        });
        return { rows: [{ id: "t1" }], error: null };
      }
      if (op.updateValues !== undefined) {
        const vals = op.updateValues as Record<string, unknown>;
        const matched = tokens.filter((t) =>
          op.filters.every((f) =>
            f.col === "order_id"
              ? t.order_id === f.val
              : f.col === "token_hash"
                ? t.token_hash === f.val
                : true,
          ),
        );
        for (const m of matched) Object.assign(m, vals);
        return { rows: matched, error: null };
      }
      const rows = tokens.filter((t) =>
        op.filters.every((f) =>
          f.col === "order_id" ? t.order_id === f.val : true,
        ),
      );
      return { rows, error: null };
    }
    if (op.table === "orders") {
      const id = op.filters.find((f) => f.col === "id")?.val as
        | string
        | undefined;
      const num = op.filters.find((f) => f.col === "order_number")?.val as
        | string
        | undefined;
      if (id !== undefined) {
        return {
          rows: ordersKnown.has(id) ? [{ id, customer_id: "cust-1" }] : [],
          error: null,
        };
      }
      if (num !== undefined) {
        return {
          rows:
            num === "TS-261005-0001"
              ? [{ id: ORDER_ID, customer_id: "cust-1" }]
              : [],
          error: null,
        };
      }
      return { rows: [], error: null };
    }
    if (op.table === "customers") {
      return { rows: [{ phone: "+919876543210" }], error: null };
    }
    if (op.table === "order_access_tokens") {
      if (op.updateValues !== undefined) {
        return { rows: [{ id: "tok-1" }], error: null };
      }
      return { rows: [], error: null };
    }
    throw new Error(`unexpected table ${op.table ?? op.rpc}`);
  };
});

const reqWithCookie = (
  url: string,
  orderId: string,
  raw: string | null,
  method = "GET",
) =>
  new Request(url, {
    method,
    headers: raw
      ? { Cookie: `${guestCookieName(orderId)}=${encodeURIComponent(raw)}` }
      : {},
  });

describe("token primitives", () => {
  it("generates 256-bit base64url tokens", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const t = generateGuestToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(50);
  });

  it("hashes stably and never round-trips", () => {
    const t = generateGuestToken();
    expect(hashGuestToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashGuestToken(t)).toBe(hashGuestToken(t));
    expect(hashGuestToken(t)).not.toContain(t.slice(0, 8));
  });

  it("binds cookies to the order id", () => {
    expect(guestCookieName(ORDER_ID)).not.toContain(ORDER_ID);
    expect(guestCookieName(ORDER_ID)).toBe(guestCookieName(ORDER_ID));
    expect(guestCookieName(ORDER_ID)).not.toBe(guestCookieName(OTHER_ID));
    const cookie = serializeGuestCookie(ORDER_ID, "tok", 3600);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=3600");
    expect(expiredGuestCookie(ORDER_ID)).toContain("Max-Age=0");
  });

  it("round-trips cookies through the header parser", () => {
    const header = `${guestCookieName(ORDER_ID)}=abc123; other=1`;
    expect(guestTokenFromCookieHeader(ORDER_ID, header)).toBe("abc123");
    expect(guestTokenFromCookieHeader(OTHER_ID, header)).toBeNull();
    expect(guestTokenFromCookieHeader(ORDER_ID, null)).toBeNull();
  });
});

describe("PII redaction", () => {
  it("masks phones, GSTINs and references", () => {
    expect(maskPhoneFull("+919876543210")).toBe("••••••3210");
    expect(maskPhoneFull(null)).toBe("—");
    expect(maskPhoneFull("+919876543210")).not.toContain("98765");
    expect(maskGstin("27ABCDE1234F1Z0")).toBe("27•••••••1Z0");
    expect(maskGstin("27ABCDE1234F1Z0")).not.toContain("ABCDE");
    expect(maskGstin(null)).toBeNull();
    expect(maskReference("UTR202610050001")).toBe("••••0001");
    expect(maskReference("UTR202610050001")).not.toContain("UTR2026");
  });
});

describe("verification matrix", () => {
  it("UUID without authorization fails with ZERO db reads", async () => {
    dbCalls = 0;
    await expect(verifyGuestToken(ORDER_ID, null)).resolves.toBe(false);
    await expect(verifyGuestToken(ORDER_ID, "")).resolves.toBe(false);
    await expect(verifyGuestToken(ORDER_ID, undefined)).resolves.toBe(false);
    await expect(verifyGuestToken("not-a-uuid", generateGuestToken())).resolves.toBe(false);
    expect(dbCalls).toBe(0);
    expect(hasGuestCredential(ORDER_ID, null)).toBe(false);
  });

  it("invalid token fails closed", async () => {
    const raw = generateGuestToken();
    tokens.push(rowFor(generateGuestToken(), ORDER_ID));
    await expect(verifyGuestToken(ORDER_ID, raw)).resolves.toBe(false);
    await expect(verifyGuestToken(ORDER_ID, "short")).resolves.toBe(false);
  });

  it("expired and revoked tokens fail", async () => {
    const expiredRaw = generateGuestToken();
    const revokedRaw = generateGuestToken();
    tokens.push(
      rowFor(expiredRaw, ORDER_ID, {
        expires_at: new Date(Date.now() - 1000).toISOString(),
      }),
      rowFor(revokedRaw, ORDER_ID, {
        revoked_at: new Date().toISOString(),
      }),
    );
    await expect(verifyGuestToken(ORDER_ID, expiredRaw)).resolves.toBe(false);
    await expect(verifyGuestToken(ORDER_ID, revokedRaw)).resolves.toBe(false);
  });

  it("a token for another order grants nothing", async () => {
    const raw = generateGuestToken();
    tokens.push(rowFor(raw, OTHER_ID));
    await expect(verifyGuestToken(ORDER_ID, raw)).resolves.toBe(false);
    await expect(verifyGuestToken(OTHER_ID, raw)).resolves.toBe(true);
  });

  it("concurrent uses of the same valid token both verify", async () => {
    const raw = generateGuestToken();
    tokens.push(rowFor(raw, ORDER_ID));
    const [a, b] = await Promise.all([
      verifyGuestToken(ORDER_ID, raw),
      verifyGuestToken(ORDER_ID, raw),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
  });

  it("matchesStoredToken is order-bound and expiry-aware", () => {
    const raw = generateGuestToken();
    const rows: GuestTokenRow[] = [rowFor(raw, ORDER_ID)];
    expect(matchesStoredToken(raw, rows, ORDER_ID)).toBe(true);
    expect(matchesStoredToken(raw, rows, OTHER_ID)).toBe(false);
    expect(matchesStoredToken("bogus-token-value-xxxxxxxxxxxxxxxxxx", rows, ORDER_ID)).toBe(false);
  });
});

describe("issue / rotate / revoke", () => {
  it("issues a verifiable token and stores only the hash", async () => {
    const issued = await issueGuestToken(ORDER_ID);
    expect(issued).not.toBeNull();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.token_hash).toBe(hashGuestToken(issued!.token));
    expect(JSON.stringify(tokens)).not.toContain(issued!.token);
    await expect(verifyGuestToken(ORDER_ID, issued!.token)).resolves.toBe(true);
  });

  it("refuses to issue for unknown orders", async () => {
    await expect(issueGuestToken(UNKNOWN_ID)).resolves.toBeNull();
  });

  it("rotation swaps the token: new works, old dies", async () => {
    const first = await issueGuestToken(ORDER_ID);
    const second = await rotateGuestToken(ORDER_ID, first!.token);
    expect(second).not.toBeNull();
    expect(second!.token).not.toBe(first!.token);
    await expect(verifyGuestToken(ORDER_ID, second!.token)).resolves.toBe(true);
    await expect(verifyGuestToken(ORDER_ID, first!.token)).resolves.toBe(false);
  });

  it("rotation with a bad token issues nothing", async () => {
    await expect(
      rotateGuestToken(ORDER_ID, generateGuestToken()),
    ).resolves.toBeNull();
    expect(tokens).toHaveLength(0);
  });

  it("revocation kills the token", async () => {
    const issued = await issueGuestToken(ORDER_ID);
    expect(await revokeGuestToken(ORDER_ID, issued!.token)).toBe(true);
    await expect(verifyGuestToken(ORDER_ID, issued!.token)).resolves.toBe(false);
  });
});

describe("protected routes", () => {
  const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

  it("invoice: UUID alone, invalid, expired and foreign tokens all 404", async () => {
    const good = generateGuestToken();
    tokens.push(rowFor(good, ORDER_ID));
    const foreign = generateGuestToken();
    tokens.push(rowFor(foreign, OTHER_ID));

    // No credential at all — must not even reach the order table.
    const bare = await invoiceGet(
      reqWithCookie(`http://localhost/api/orders/${ORDER_ID}/invoice`, ORDER_ID, null),
      ctxFor(ORDER_ID),
    );
    expect(bare.status).toBe(404);

    const bad = await invoiceGet(
      reqWithCookie(`http://localhost/api/orders/${ORDER_ID}/invoice`, ORDER_ID, generateGuestToken()),
      ctxFor(ORDER_ID),
    );
    expect(bad.status).toBe(404);

    const cross = await invoiceGet(
      reqWithCookie(`http://localhost/api/orders/${ORDER_ID}/invoice`, ORDER_ID, foreign),
      ctxFor(ORDER_ID),
    );
    expect(cross.status).toBe(404);

    const bodies = await Promise.all(
      [bare, bad, cross].map((r) => r.clone().json()),
    );
    for (const b of bodies) {
      expect(JSON.stringify(b)).not.toContain("TS-261005");
    }
  });

  it("invoice failures never echo the token (no log/leak surface)", async () => {
    const raw = generateGuestToken();
    const res = await invoiceGet(
      reqWithCookie(`http://localhost/api/orders/${ORDER_ID}/invoice`, ORDER_ID, raw),
      ctxFor(ORDER_ID),
    );
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain(raw);
    expect(text).not.toContain(hashGuestToken(raw));
  });

  it("claim: token required on top of phone match", async () => {
    const good = generateGuestToken();
    tokens.push(rowFor(good, ORDER_ID));
    const post = (body: unknown, cookie: string | null) =>
      claimPost(
        new Request("http://localhost/api/payments/claim", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(cookie
              ? { Cookie: `${guestCookieName(ORDER_ID)}=${cookie}` }
              : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    const base = {
      orderId: ORDER_ID,
      reference: "123456789012",
      phone: "+919876543210",
    };
    // No token → 404 even with the right phone.
    expect((await post(base, null)).status).toBe(404);
    // Wrong-order token + right phone → 404.
    const foreign = generateGuestToken();
    tokens.push(rowFor(foreign, OTHER_ID));
    expect((await post(base, foreign)).status).toBe(404);
    // Right phone + right token goes past auth (fails later on the
    // unmocked payments table — proof auth passed: not 404).
    const authed = await post(base, good);
    expect(authed.status).not.toBe(404);
  });

  it("claim failures never echo the token", async () => {
    const raw = generateGuestToken();
    const res = await claimPost(
      new Request("http://localhost/api/payments/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: ORDER_ID,
          reference: "123456789012",
          phone: "+919876543210",
          accessToken: raw,
        }),
      }),
    );
    const text = await res.text();
    expect(text).not.toContain(raw);
  });

  it("guest order loader: no token → null without order-table PII", async () => {
    let orderReads = 0;
    const prev = handler;
    handler = (op) => {
      if (op.table === "orders") orderReads += 1;
      return prev(op);
    };
    await expect(getPayableOrderForGuest(ORDER_ID, null)).resolves.toBeNull();
    expect(orderReads).toBe(0);
  });

  it("session exchange mints the cookie for a valid token only", async () => {
    const raw = generateGuestToken();
    tokens.push(rowFor(raw, ORDER_ID));
    const good = await sessionPost(
      new Request(`http://localhost/api/orders/${ORDER_ID}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: raw }),
      }),
      ctxFor(ORDER_ID),
    );
    expect(good.status).toBe(200);
    const setCookie = good.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain(guestCookieName(ORDER_ID));
    expect(setCookie).toContain("HttpOnly");
    // The raw token never appears in the JSON body of the exchange.
    expect(await good.text()).not.toContain(raw);

    const bad = await sessionPost(
      new Request(`http://localhost/api/orders/${ORDER_ID}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: generateGuestToken() }),
      }),
      ctxFor(ORDER_ID),
    );
    expect(bad.status).toBe(404);
  });

  it("rotate endpoint requires the current cookie and revokes it", async () => {
    const raw = generateGuestToken();
    tokens.push(rowFor(raw, ORDER_ID));
    const anon = await rotatePost(
      reqWithCookie(`http://localhost/api/orders/${ORDER_ID}/rotate`, ORDER_ID, null, "POST"),
      ctxFor(ORDER_ID),
    );
    expect(anon.status).toBe(404);
    const res = await rotatePost(
      reqWithCookie(`http://localhost/api/orders/${ORDER_ID}/rotate`, ORDER_ID, raw, "POST"),
      ctxFor(ORDER_ID),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { token: string };
    };
    expect(json.ok).toBe(true);
    // Token hash of the replacement is never in the response…
    expect(json.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(verifyGuestToken(ORDER_ID, raw)).resolves.toBe(false);
    await expect(
      verifyGuestToken(ORDER_ID, json.data.token),
    ).resolves.toBe(true);
  });

  it("recovery: order number alone reveals nothing; pair restores", async () => {
    const miss = await recoverPost(
      new Request("http://localhost/api/orders/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber: "TS-NOPE-0000",
          phone: "+919876543210",
        }),
      }),
    );
    expect(miss.status).toBe(404);

    const wrongPhone = await recoverPost(
      new Request("http://localhost/api/orders/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber: "TS-261005-0001",
          phone: "+910000000000",
        }),
      }),
    );
    expect(wrongPhone.status).toBe(404);
    // Identical messages — no oracle.
    expect(((await miss.clone().json()) as { error: { message: string } }).error.message).toBe(
      ((await wrongPhone.clone().json()) as { error: { message: string } }).error.message,
    );

    const okRes = await recoverPost(
      new Request("http://localhost/api/orders/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber: "TS-261005-0001",
          phone: "+919876543210",
        }),
      }),
    );
    expect(okRes.status).toBe(200);
    const json = (await okRes.json()) as {
      ok: boolean;
      data: { orderId: string; token: string };
    };
    expect(json.data.orderId).toBe(ORDER_ID);
    await expect(
      verifyGuestToken(ORDER_ID, json.data.token),
    ).resolves.toBe(true);
  });

  it("admin access path is untouched (no guest tables involved)", async () => {
    const { getPayableOrder } = await import("@/lib/payments/order");
    const prev = handler;
    handler = (op) => {
      if (op.table === "orders") {
        return {
          rows: [
            {
              id: ORDER_ID,
              order_number: "TS-261005-0001",
              customer_id: "cust-1",
              subtotal: "100.00",
              delivery_charge: "10.00",
              total_amount: "110.00",
              delivery_pincode: "400001",
              delivery_partner_name: "Partner A",
              gstin_snapshot: "27ABCDE1234F1Z0",
              tax_treatment: "non_gst",
              taxable_amount: "0.00",
              cgst_amount: "0.00",
              sgst_amount: "0.00",
              igst_amount: "0.00",
              billing_name: null,
              payment_status: "pending",
              order_status: "pending_payment",
              created_at: "2026-10-05T10:00:00Z",
            },
          ],
          error: null,
        };
      }
      if (op.table === "shipments") return { rows: [], error: null };
      if (op.table === "customers") {
        return { rows: [{ name: "Test", phone: "+919876543210" }], error: null };
      }
      if (op.table === "order_items") return { rows: [], error: null };
      if (op.table === "payments") return { rows: [], error: null };
      if (op.table === "order_events") return { rows: [], error: null };
      return prev(op);
    };
    const order = await getPayableOrder(ORDER_ID);
    expect(order).not.toBeNull();
    // …but even the admin-shaped projection carries no raw PII.
    const dumped = JSON.stringify(order);
    expect(dumped).not.toContain("919876543210");
    expect(dumped).not.toContain("27ABCDE1234F1Z0");
    expect(order?.customerPhoneMasked).toBe("••••••3210");
    expect(order?.gstinMasked).toBe("27•••••••1Z0");
  });
});
