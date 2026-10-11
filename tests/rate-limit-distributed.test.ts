import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import {
  checkRateLimit,
  denyIfLimited,
  resetRateLimits,
  resolveBackend,
  routeLimit,
} from "@/lib/rate-limit/index";
import {
  getUpstashStore,
  slidingWindowScript,
} from "@/lib/rate-limit/upstash";
import { resetReadyCache } from "@/app/api/ready/route";

let adminHandler: MockResponder = () => {
  throw new Error("unexpected admin query");
};
let serverHandler: MockResponder = () => {
  throw new Error("unexpected server query");
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createMockClient(serverHandler, { authUser: { id: "admin-1" } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(adminHandler),
}));

const SAVED_ENV = { ...process.env };

beforeEach(() => {
  resetRateLimits();
  resetReadyCache();
  delete process.env.RATE_LIMIT_BACKEND;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.TRUST_PROXY_HEADERS;
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("RATE_LIMIT_") && k !== "RATE_LIMIT_BACKEND") {
      delete process.env[k];
    }
  }
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
  resetRateLimits();
  resetReadyCache();
  vi.useRealTimers();
});

/* ─── Mock shared backend: atomic Lua emulation ──────────────────────
 * Executes the whole prune→count→admit step synchronously per call,
 * exactly like a server-side Lua script: concurrent callers serialize
 * on the event loop with no interleaving, so the budget is exact.
 */
interface ZSet {
  members: Array<{ score: number; member: string }>;
  pexpireAt: number;
}

function createMockUpstash() {
  const data = new Map<string, ZSet>();
  const calls: Array<{ url: string; auth: string | null }> = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    const headers = new Headers(init?.headers);
    calls.push({ url: href, auth: headers.get("authorization") });
    const parts = href.split("/");
    const evalIdx = parts.lastIndexOf("eval");
    const seg = parts.slice(evalIdx + 1).map(decodeURIComponent);
    // [script, "1", key, now, window, limit, member]
    const [, , keyRaw, nowRaw, windowRaw, limitRaw, memberRaw] = seg;
    const key = keyRaw ?? "";
    const member = memberRaw ?? "";
    const now = Number(nowRaw);
    const windowMs = Number(windowRaw);
    const limit = Number(limitRaw);
    let z = data.get(key);
    if (!z || z.pexpireAt <= now) {
      z = { members: [], pexpireAt: now + windowMs };
      data.set(key, z);
    }
    z.members = z.members.filter((m) => m.score > now - windowMs);
    let payload: unknown;
    if (z.members.length >= limit) {
      const oldest = [...z.members].sort((a, b) => a.score - b.score)[0];
      const reset = oldest ? Math.max(0, oldest.score + windowMs - now) : windowMs;
      payload = { result: [0, reset] };
    } else {
      z.members.push({ score: now, member });
      z.pexpireAt = now + windowMs;
      payload = { result: [1, windowMs, z.members.length] };
    }
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
  return { fetchFn, calls, data };
}

const withUpstashEnv = () => {
  process.env.UPSTASH_REDIS_REST_URL = "https://mock.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "mock-token";
};

const req = (headers?: Record<string, string>) =>
  new Request("http://localhost/x", { method: "POST", headers: { ...(headers ?? {}) } });

describe("Upstash adapter (mock-tested; live enforcement UNVERIFIED)", () => {
  it("ships an atomic single-script sliding window", () => {
    const lua = slidingWindowScript();
    expect(lua).toContain("ZREMRANGEBYSCORE");
    expect(lua).toContain("ZCARD");
    expect(lua).toContain("ZADD");
    expect(lua).toContain("PEXPIRE");
    // One script = one server round-trip = atomic prune→admit.
    expect(lua).not.toContain("identity");
  });

  it("two instances sharing one store enforce ONE budget", async () => {
    withUpstashEnv();
    const { fetchFn } = createMockUpstash();
    const a = getUpstashStore(fetchFn);
    const b = getUpstashStore(fetchFn);
    const opts = { limit: 3, windowMs: 60_000 };
    expect((await a.check("k", opts)).allowed).toBe(true);
    expect((await b.check("k", opts)).allowed).toBe(true);
    expect((await a.check("k", opts)).allowed).toBe(true);
    // Budget is global, not per-instance.
    expect((await b.check("k", opts)).allowed).toBe(false);
    expect((await a.check("k", opts)).allowed).toBe(false);
  });

  it("atomic concurrent requests admit exactly the limit", async () => {
    withUpstashEnv();
    const { fetchFn } = createMockUpstash();
    const store = getUpstashStore(fetchFn);
    const opts = { limit: 10, windowMs: 60_000 };
    const results = await Promise.all(
      Array.from({ length: 30 }, () => store.check("hot-key", opts)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(results.filter((r) => !r.allowed)).toHaveLength(20);
    for (const r of results.filter((x) => !x.allowed)) {
      expect(r.resetMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("window expiration readmits (fake timers)", async () => {
    withUpstashEnv();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const { fetchFn } = createMockUpstash();
      const store = getUpstashStore(fetchFn);
      const opts = { limit: 1, windowMs: 60_000 };
      expect((await store.check("k", opts)).allowed).toBe(true);
      expect((await store.check("k", opts)).allowed).toBe(false);
      vi.setSystemTime(1_000_000 + 60_001);
      expect((await store.check("k", opts)).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends credentials only in the Authorization header, never the URL", async () => {
    withUpstashEnv();
    const { fetchFn, calls } = createMockUpstash();
    const store = getUpstashStore(fetchFn);
    await store.check("k", { limit: 5, windowMs: 60_000 });
    expect(calls).toHaveLength(1);
    const [only] = calls;
    expect(only?.auth).toBe("Bearer mock-token");
    expect(only?.url).not.toContain("mock-token");
  });

  it("missing credentials fail before any network call", async () => {
    const { fetchFn, calls } = createMockUpstash();
    const store = getUpstashStore(fetchFn);
    await expect(store.check("k", { limit: 1, windowMs: 60_000 })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("backend resolution", () => {
  it("auto-selects upstash when configured, memory otherwise", () => {
    expect(resolveBackend()).toBe("memory");
    withUpstashEnv();
    expect(resolveBackend()).toBe("upstash");
    process.env.RATE_LIMIT_BACKEND = "memory";
    expect(resolveBackend()).toBe("memory");
    process.env.RATE_LIMIT_BACKEND = "upstash";
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(resolveBackend()).toBe("upstash");
  });
});

describe("store timeout / unavailability policy", () => {
  it("mutations fail CLOSED, reads fail SAFE (open + degraded)", async () => {
    // Hanging upstream that honors abort, like Node fetch does: the
    // adapter's AbortSignal.timeout must win, never the request.
    const hanging = ((url: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("The operation was aborted.");
        err.name = "TimeoutError";
        reject(err);
      });
    })) as unknown as typeof fetch;
    const { UpstashRateLimitStore } = await import("@/lib/rate-limit/upstash");
    process.env.RATE_LIMIT_UPSTREAM_TIMEOUT_MS = "25";
    const store = new UpstashRateLimitStore(hanging);
    withUpstashEnv();

    const closed = await checkRateLimit(req(), "orders", { store });
    expect(closed.allowed).toBe(false);
    expect(closed.degraded).toBe(true);

    const open = await checkRateLimit(req(), "delivery", { store });
    expect(open.allowed).toBe(true);
    expect(open.degraded).toBe(true);

    const claimClosed = await checkRateLimit(req(), "claim", { store });
    expect(claimClosed.allowed).toBe(false);
    const invoiceOpen = await checkRateLimit(req(), "invoice", { store });
    expect(invoiceOpen.allowed).toBe(true);
  });

  it("rejecting backend surfaces no internals to callers", async () => {
    const failing = (async () => {
      throw new Error("connect ECONNREFUSED secret-host:6379");
    }) as unknown as typeof fetch;
    const { UpstashRateLimitStore } = await import("@/lib/rate-limit/upstash");
    withUpstashEnv();
    const store = new UpstashRateLimitStore(failing);
    const denied = await denyIfLimited("orders", await checkRateLimit(req(), "orders", { store }));
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(429);
    const text = await denied!.text();
    expect(text).not.toContain("secret-host");
    expect(text).not.toContain("6379");
    expect(text).not.toContain("mock-token");
  });
});

describe("production without shared store", () => {
  it("fails closed for mutations, degraded-open for reads", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      // No UPSTASH vars, no explicit backend → memory in production.
      const orders = await checkRateLimit(req(), "orders");
      expect(orders.allowed).toBe(false);
      expect(orders.degraded).toBe(true);

      const delivery = await checkRateLimit(req(), "delivery");
      expect(delivery.allowed).toBe(true);
      expect(delivery.degraded).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("explicit memory opt-in is honored (disposable staging), logged", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RATE_LIMIT_BACKEND", "memory");
    try {
      const orders = await checkRateLimit(req(), "orders");
      expect(orders.allowed).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("429 behavior", () => {
  it("denyIfLimited returns logged 429s with Retry-After", async () => {
    const denied = await denyIfLimited("orders", {
      allowed: false,
      remaining: 0,
      resetMs: 61_000,
    });
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(429);
    expect(denied!.headers.get("Retry-After")).toBe("61");
    expect(await denyIfLimited("orders", { allowed: true, remaining: 1, resetMs: 1000 })).toBeNull();
  });

  it("spoofed forwarding headers cannot dodge or poison buckets", async () => {
    const limit = routeLimit("orders").limit;
    // Attacker claims a fresh IP on every request — all land in the
    // shared "unknown" bucket, which still exhausts.
    for (let i = 0; i < limit; i++) {
      expect(
        (await checkRateLimit(req({ "x-forwarded-for": `10.0.0.${i}` }), "orders")).allowed,
      ).toBe(true);
    }
    expect(
      (await checkRateLimit(req({ "x-forwarded-for": "10.99.99.99" }), "orders")).allowed,
    ).toBe(false);
  });
});

describe("endpoint abuse budgets", () => {
  it("legitimate admin listing traffic fits the admin budget", async () => {
    const limit = routeLimit("admin").limit;
    expect(limit).toBeGreaterThanOrEqual(100);
    for (let i = 0; i < limit; i++) {
      const r = await checkRateLimit(
        req({ "x-vercel-forwarded-for": "203.0.113.7" }),
        "admin",
      );
      expect(r.allowed).toBe(true);
    }
    expect(
      (await checkRateLimit(req({ "x-vercel-forwarded-for": "203.0.113.7" }), "admin")).allowed,
    ).toBe(false);
  });

  it("recovery budget is tight (enumeration defense)", () => {
    expect(routeLimit("recover").limit).toBeLessThanOrEqual(5);
    expect(routeLimit("recover").onBackendError).toBe("closed");
  });

  it("office-NAT sharing: delivery budget fits a crowd", () => {
    expect(routeLimit("delivery").limit).toBeGreaterThanOrEqual(60);
  });
});

describe("claim abuse end to end (token + budget)", () => {
  const OID = "c0ffee00-0001-4000-8000-000000000001";

  it("third rapid claim is 429 with Retry-After (not a state error)", async () => {
    // The mock never mutates payment state, so every request would
    // succeed on merit — only the budget stops the flood.
    process.env.RATE_LIMIT_CLAIM_PER_MIN = "2";
    const { POST } = await import("@/app/api/payments/claim/route");
    const { generateGuestToken, hashGuestToken } = await import("@/lib/guest-access/tokens");
    const raw = generateGuestToken();
    const tokenRow = {
      token_hash: hashGuestToken(raw),
      order_id: OID,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
      revoked_at: null,
    };
    adminHandler = (op) => {
      if (op.table === "order_access_tokens" && op.updateValues === undefined) {
        return { rows: [tokenRow], error: null };
      }
      if (op.table === "order_access_tokens") return { rows: [{ id: "t" }], error: null };
      if (op.table === "orders" && !op.updateValues) {
        return { rows: [{ id: OID, order_number: "TS-1", customer_id: "c1", payment_status: "pending", order_status: "pending_payment" }], error: null };
      }
      if (op.table === "customers") return { rows: [{ phone: "+919876543210" }], error: null };
      if (op.table === "payments" && !op.updateValues) return { rows: [{ id: "p1", status: "pending" }], error: null };
      if (op.updateValues) return { rows: [{ id: "x" }], error: null };
      if (op.table === "order_events") return { rows: [{ id: "e1" }], error: null };
      throw new Error(`unexpected ${op.table}`);
    };
    const post = (reference: string) =>
      POST(
        new Request("http://localhost/api/payments/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: OID, reference, phone: "+919876543210", accessToken: raw }),
        }),
      );
    expect((await post("123456789012")).status).toBe(200);
    expect((await post("123456789013")).status).toBe(200);
    const third = await post("123456789014");
    expect(third.status).toBe(429);
    expect(third.headers.get("Retry-After")).toMatch(/^\d+$/);
  });
});

describe("import/export abuse", () => {
  it("import budget trips fast under flood", async () => {
    const limit = routeLimit("import").limit;
    for (let i = 0; i < limit; i++) {
      expect((await checkRateLimit(req(), "import")).allowed).toBe(true);
    }
    const denied = await denyIfLimited("import", await checkRateLimit(req(), "import"));
    expect(denied?.status).toBe(429);
  });

  it("export flood is 429, not served", async () => {
    serverHandler = (op) => {
      if (op.table === "profiles") return { rows: [{ is_admin: true }], error: null };
      if (op.table === "products" && !op.updateValues) return { rows: [], error: null, count: 0 };
      throw new Error(`unexpected server ${op.table}`);
    };
    adminHandler = (op) => {
      if (op.table === "products" && !op.updateValues) return { rows: [], error: null, count: 0 };
      if (op.table === "admin_audit_log") return { rows: [{ id: "a1" }], error: null };
      throw new Error(`unexpected ${op.table ?? op.rpc}`);
    };
    const { GET } = await import("@/app/api/admin/export/[type]/route");
    const get = () =>
      GET(new Request("http://localhost/x"), { params: Promise.resolve({ type: "products" }) });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push((await get()).status);
    }
    expect(codes).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 429, 429]);
  });
});

describe("health vs readiness", () => {
  it("health stays lightweight with no backend reads", async () => {
    let reads = 0;
    adminHandler = () => {
      reads += 1;
      return { rows: [], error: null };
    };
    const { GET } = await import("@/app/api/health/route");
    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    expect(reads).toBe(0);
    const json = (await res.json()) as { data: Record<string, unknown> };
    expect(JSON.stringify(json)).not.toMatch(/key|secret|token|password|schema/i);
  });

  it("readiness caches the verdict (one DB hit per window)", async () => {
    let reads = 0;
    adminHandler = () => {
      reads += 1;
      return { rows: [{ id: "o1" }], error: null };
    };
    const { GET } = await import("@/app/api/ready/route");
    const get = () => GET(new Request("http://localhost/api/ready"));
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    expect(reads).toBe(1);
  });

  it("readiness is rate-limited under poll storms", async () => {
    adminHandler = () => ({ rows: [{ id: "o1" }], error: null });
    const { GET } = await import("@/app/api/ready/route");
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) {
      codes.push((await GET(new Request("http://localhost/api/ready"))).status);
    }
    expect(codes.filter((s) => s === 429).length).toBeGreaterThan(0);
  });

  it("readiness failure is a safe 503 with no internals", async () => {
    adminHandler = () => {
      throw new Error("connect secret-db-host:5432 refused");
    };
    const { GET } = await import("@/app/api/ready/route");
    const res = await GET(new Request("http://localhost/api/ready"));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).not.toContain("secret-db-host");
    expect(text).not.toContain("5432");
    expect(JSON.stringify(text)).not.toMatch(/password|credential|schema/i);
  });
});

describe("no secret leakage", () => {
  it("errors and 429s never carry backend secrets", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://secret-host.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "super-secret-token";
    const failing = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const { UpstashRateLimitStore } = await import("@/lib/rate-limit/upstash");
    const store = new UpstashRateLimitStore(failing);
    for (const category of ["orders", "claim", "delivery", "export", "ready"] as const) {
      const denied = await denyIfLimited(category, await checkRateLimit(req(), category, { store }));
      if (denied) {
        const text = await denied.text();
        expect(text).not.toContain("super-secret-token");
        expect(text).not.toContain("secret-host");
      }
    }
  });
});
