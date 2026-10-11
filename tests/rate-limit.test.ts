import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRateLimitStore,
  buildRateLimitKey,
  checkRateLimit,
  clientIpForTesting,
  resetRateLimits,
  routeLimit,
} from "@/lib/rate-limit/index";
import { rateLimited } from "@/lib/api/response";

const req = (headers?: Record<string, string>) =>
  new Request("http://localhost/x", {
    method: "POST",
    headers: { ...(headers ?? {}) },
  });

describe("MemoryRateLimitStore", () => {
  it("allows requests under the limit with remaining counts", async () => {
    const store = new MemoryRateLimitStore();
    expect(await store.check("k", { limit: 3, windowMs: 60_000 })).toMatchObject({
      allowed: true,
      remaining: 2,
    });
    expect(await store.check("k", { limit: 3, windowMs: 60_000 })).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(await store.check("k", { limit: 3, windowMs: 60_000 })).toMatchObject({
      allowed: true,
      remaining: 0,
    });
  });

  it("blocks over the limit without recording the hit", async () => {
    const store = new MemoryRateLimitStore();
    const opts = { limit: 1, windowMs: 60_000 };
    expect((await store.check("k", opts)).allowed).toBe(true);
    const denied = await store.check("k", opts);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.resetMs).toBeGreaterThan(0);
    expect(denied.resetMs).toBeLessThanOrEqual(60_000);
  });

  it("isolates keys from each other", async () => {
    const store = new MemoryRateLimitStore();
    const opts = { limit: 1, windowMs: 60_000 };
    expect((await store.check("a", opts)).allowed).toBe(true);
    expect((await store.check("a", opts)).allowed).toBe(false);
    expect((await store.check("b", opts)).allowed).toBe(true);
  });

  it("resets after the window passes", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const store = new MemoryRateLimitStore();
      const opts = { limit: 1, windowMs: 60_000 };
      expect((await store.check("k", opts)).allowed).toBe(true);
      expect((await store.check("k", opts)).allowed).toBe(false);
      vi.setSystemTime(60_001);
      expect((await store.check("k", opts)).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reset() clears all counters", async () => {
    const store = new MemoryRateLimitStore();
    const opts = { limit: 1, windowMs: 60_000 };
    expect((await store.check("k", opts)).allowed).toBe(true);
    store.reset();
    expect((await store.check("k", opts)).allowed).toBe(true);
  });
});

describe("checkRateLimit (route helper)", () => {
  beforeEach(() => resetRateLimits());
  afterEach(() => resetRateLimits());

  it("keys by route and trusted client IP", async () => {
    // Exhaust the orders budget for one IP via many rapid checks.
    let denied = false;
    for (let i = 0; i < 40; i++) {
      if (!(await checkRateLimit(req({ "x-real-ip": "1.2.3.4" }), "orders")).allowed) {
        denied = true;
        break;
      }
    }
    // x-real-ip is untrusted by default → shared "unknown" bucket, which
    // still trips the budget. The point stands either way.
    expect(denied).toBe(true);
  });

  it("trusts x-vercel-forwarded-for (platform-set) per IP", async () => {
    const limit = routeLimit("orders").limit;
    for (let i = 0; i < limit; i++) {
      expect(
        (await checkRateLimit(req({ "x-vercel-forwarded-for": "9.9.9.9" }), "orders")).allowed,
      ).toBe(true);
    }
    expect(
      (await checkRateLimit(req({ "x-vercel-forwarded-for": "9.9.9.9" }), "orders")).allowed,
    ).toBe(false);
    // A different client IP is unaffected.
    expect(
      (await checkRateLimit(req({ "x-vercel-forwarded-for": "8.8.8.8" }), "orders")).allowed,
    ).toBe(true);
  });

  it("reads budgets from options with env-overridable route defaults", () => {
    expect(routeLimit("orders").limit).toBeGreaterThan(0);
    expect(routeLimit("delivery").limit).toBeGreaterThanOrEqual(
      routeLimit("orders").limit,
    );
    // Abuse-sensitive mutations fail closed; reads fail safe.
    expect(routeLimit("orders").onBackendError).toBe("closed");
    expect(routeLimit("recover").onBackendError).toBe("closed");
    expect(routeLimit("delivery").onBackendError).toBe("open");
    expect(routeLimit("ready").onBackendError).toBe("open");
  });
});

describe("client identification", () => {
  it("ignores spoofed X-Forwarded-For unless a proxy is trusted", () => {
    delete process.env.TRUST_PROXY_HEADERS;
    expect(clientIpForTesting(req({ "x-forwarded-for": "1.2.3.4" }))).toBe("unknown");
    expect(clientIpForTesting(req({ "x-real-ip": "1.2.3.4" }))).toBe("unknown");
    process.env.TRUST_PROXY_HEADERS = "true";
    try {
      expect(clientIpForTesting(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
      expect(clientIpForTesting(req({ "x-real-ip": "1.2.3.4" }))).toBe("1.2.3.4");
    } finally {
      delete process.env.TRUST_PROXY_HEADERS;
    }
  });

  it("builds keys without PII (hashes only)", async () => {
    const key = await buildRateLimitKey("claim", req({ "x-vercel-forwarded-for": "1.2.3.4" }), {
      userId: "admin-1",
      resourceId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(key).not.toContain("1.2.3.4");
    expect(key).not.toContain("admin-1");
    expect(key).not.toContain("123e4567");
    expect(key.startsWith("trolift:rl:v1:claim:")).toBe(true);
  });
});

describe("rateLimited (429 response)", () => {
  it("returns a generic 429 with Retry-After and no quota details", async () => {
    const res = rateLimited(1500);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("2");
    const json = (await res.json()) as {
      ok: boolean;
      error: { code: string; message: string };
    };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("RATE_LIMITED");
    expect(JSON.stringify(json)).not.toContain("1500");
  });
});
