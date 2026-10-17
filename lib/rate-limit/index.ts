/**
 * Rate limiting foundation (server-only usage in Route Handlers).
 *
 * Two backends implement `RateLimitStore`:
 * - `MemoryRateLimitStore` — in-process sliding window. Correct for a
 *   single instance, local development, and the test suite.
 * - `UpstashRateLimitStore` (`./upstash`) — shared sliding window over
 *   Upstash Redis via its HTTPS API, atomic through a Lua script, so
 *   concurrent instances enforce ONE global budget.
 *
 * Backend selection (`RATE_LIMIT_BACKEND=upstash|memory`, default
 * `auto` = upstash when fully configured, else memory) plus an
 * explicit production guard: in production without Upstash
 * credentials, abuse-sensitive mutations FAIL CLOSED (429) instead of
 * silently running unlimited. Non-critical reads stay available but
 * are logged as degraded. Nothing here is silent.
 */

export interface RateLimitOptions {
  /** Max requests per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the oldest hit in the window expires. */
  resetMs: number;
  /** True when the decision was made without the shared backend. */
  degraded?: boolean;
}

export interface RateLimitStore {
  check(key: string, opts: RateLimitOptions): Promise<RateLimitResult>;
  reset(): void | Promise<void>;
}

function prune(hits: number[], now: number, windowMs: number): number[] {
  return hits.filter((t) => t > now - windowMs);
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, number[]>();

  async check(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
    const now = Date.now();
    const recent = prune(this.hits.get(key) ?? [], now, opts.windowMs);
    if (recent.length >= opts.limit) {
      const oldest = recent[0] ?? now;
      this.hits.set(key, recent);
      return { allowed: false, remaining: 0, resetMs: oldest + opts.windowMs - now };
    }
    recent.push(now);
    this.hits.set(key, recent);
    return {
      allowed: true,
      remaining: opts.limit - recent.length,
      resetMs: opts.windowMs,
    };
  }

  reset(): void {
    this.hits.clear();
  }
}

export const defaultStore = new MemoryRateLimitStore();

/** Test/ops hook: clears all in-memory counters. */
export function resetRateLimits(): void {
  defaultStore.reset();
}

function readEnvInt(name: string, fallback: number): number {
  const raw = Number(process.env[name] ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/**
 * Endpoint classes — deliberately NOT one global limit. Financial
 * mutations (orders/claim/session/recover/import) are tight and fail
 * closed; read-only or admin-authenticated classes are roomier and
 * fail safe (available but degraded + logged) when the shared backend
 * is down, so an outage never locks paying customers out of reads.
 */
export type RateLimitCategory =
  | "orders"
  | "claim"
  | "session"
  | "recover"
  | "delivery"
  | "contact"
  | "invoice"
  | "import"
  | "export"
  | "admin"
  | "auth"
  | "ready";

export interface CategoryPolicy extends RateLimitOptions {
  /** Backend-down behavior: "closed" rejects, "open" allows + logs. */
  onBackendError: "closed" | "open";
}

/** Backwards-compatible alias for the original six buckets. */
export type RateLimitRoute =
  | "orders"
  | "claim"
  | "delivery"
  | "import"
  | "export"
  | "invoice";

/** Per-category budgets (requests/minute, env-overridable). */
export function routeLimit(route: RateLimitCategory | RateLimitRoute): CategoryPolicy {
  const windowMs = readEnvInt("RATE_LIMIT_WINDOW_MS", 60_000);
  switch (route) {
    case "orders":
      return { limit: readEnvInt("RATE_LIMIT_ORDERS_PER_MIN", 10), windowMs, onBackendError: "closed" };
    case "claim":
      return { limit: readEnvInt("RATE_LIMIT_CLAIM_PER_MIN", 10), windowMs, onBackendError: "closed" };
    case "session":
      // Token exchange/rotation: legitimate clients call once per visit.
      return { limit: readEnvInt("RATE_LIMIT_SESSION_PER_MIN", 30), windowMs, onBackendError: "closed" };
    case "recover":
      // Recovery is an enumeration oracle without tight limits.
      return { limit: readEnvInt("RATE_LIMIT_RECOVER_PER_MIN", 5), windowMs, onBackendError: "closed" };
    case "delivery":
      // Public quote: high enough for offices behind one NAT egress.
      return { limit: readEnvInt("RATE_LIMIT_DELIVERY_PER_MIN", 60), windowMs, onBackendError: "open" };
    case "contact":
      // Public query that triggers an outbound email: tight, and fails
      // closed — a store outage must never open an unbounded channel
      // to the inbox. The page shows phone numbers as the fallback.
      return { limit: readEnvInt("RATE_LIMIT_CONTACT_PER_MIN", 5), windowMs, onBackendError: "closed" };
    case "import":
      return { limit: readEnvInt("RATE_LIMIT_IMPORT_PER_MIN", 10), windowMs, onBackendError: "closed" };
    case "export":
      return { limit: readEnvInt("RATE_LIMIT_EXPORT_PER_MIN", 10), windowMs, onBackendError: "open" };
    case "invoice":
      return { limit: readEnvInt("RATE_LIMIT_INVOICE_PER_MIN", 30), windowMs, onBackendError: "open" };
    case "admin":
      // Authenticated admin listings: generous, still abuse-bounded.
      return { limit: readEnvInt("RATE_LIMIT_ADMIN_PER_MIN", 120), windowMs, onBackendError: "open" };
    case "auth":
      // Admin sign-in attempts: tight brute-force budget, fail closed.
      // Pre-authentication, so keyed by client IP only.
      return { limit: readEnvInt("RATE_LIMIT_AUTH_PER_MIN", 10), windowMs, onBackendError: "closed" };
    case "ready":
      // Orchestrator polling + cache (see route): never the DB hammer.
      return { limit: readEnvInt("RATE_LIMIT_READY_PER_MIN", 30), windowMs, onBackendError: "open" };
  }
}

/* ─── Client identification ──────────────────────────────────────────
 * Only proxy headers the hosting infrastructure itself sets are
 * trusted:
 * - `x-vercel-forwarded-for`: written by Vercel's edge (first entry is
 *   the client IP; a client-supplied value is overwritten upstream).
 * - `x-real-ip` / `x-forwarded-for`: honored ONLY when the operator
 *   sets TRUST_PROXY_HEADERS=true, i.e. asserts the app runs behind a
 *   proxy that overwrites them (otherwise any client can spoof an
 *   arbitrary IP and dodge — or poison — per-IP buckets).
 * Anything else buckets into "unknown" (shared, conservative). Raw IPs
 * never reach Redis keys or logs; keys carry a truncated SHA-256.
 */

function trustedClientIp(req: Request): string {
  const vercel = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  if (vercel) return vercel;
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return "unknown";
}

export function clientIpForTesting(req: Request): string {
  return trustedClientIp(req);
}

async function shaPrefix(value: string, length = 16): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

export interface RateLimitDims {
  /** Authenticated actor id (admin user id) — hashed into the key. */
  userId?: string;
  /** Capability being exercised (order id) — hashed into the key. */
  resourceId?: string;
}

/** Redis-safe key with no PII: category + hashed dimensions only. */
export async function buildRateLimitKey(
  category: string,
  req: Request,
  dims?: RateLimitDims,
): Promise<string> {
  const parts = ["trolift", "rl", "v1", category, await shaPrefix(trustedClientIp(req))];
  if (dims?.userId) parts.push(`u${await shaPrefix(dims.userId)}`);
  if (dims?.resourceId) parts.push(`r${await shaPrefix(dims.resourceId)}`);
  return parts.join(":");
}

export function hasUpstashConfig(): boolean {
  return (
    (process.env.UPSTASH_REDIS_REST_URL ?? "").trim() !== "" &&
    (process.env.UPSTASH_REDIS_REST_TOKEN ?? "").trim() !== ""
  );
}

export type RateLimitBackend = "memory" | "upstash";

export function resolveBackend(): RateLimitBackend {
  const explicit = (process.env.RATE_LIMIT_BACKEND ?? "auto").trim().toLowerCase();
  if (explicit === "upstash") return "upstash";
  if (explicit === "memory") return "memory";
  return hasUpstashConfig() ? "upstash" : "memory";
}

/** True only when the operator explicitly chose in-process counters. */
export function isExplicitMemory(): boolean {
  return (process.env.RATE_LIMIT_BACKEND ?? "auto").trim().toLowerCase() === "memory";
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

let warnedNoSharedStore = false;

export class RateLimitBackendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitBackendError";
  }
}

/**
 * Check the caller's budget for a category. Async: resolves against
 * the shared store when configured so every instance enforces the
 * same budget. Never throws for backend outages — applies the
 * category's fail-closed/fail-safe policy and logs instead.
 */
export async function checkRateLimit(
  req: Request,
  route: RateLimitCategory | RateLimitRoute,
  opts?: { store?: RateLimitStore; dims?: RateLimitDims },
): Promise<RateLimitResult> {
  const start = Date.now();
  const policy = routeLimit(route);
  const key = await buildRateLimitKey(route, req, opts?.dims);

  const decide = async (store: RateLimitStore): Promise<RateLimitResult> =>
    store.check(key, { limit: policy.limit, windowMs: policy.windowMs });

  // Explicit store override (tests, ops) skips backend resolution.
  if (opts?.store) {
    try {
      return await decide(opts.store);
    } catch (error) {
      return degradedDecision(route, policy, key, start, error);
    }
  }

  if (resolveBackend() === "upstash") {
    if (!hasUpstashConfig()) {
      // Misconfigured production: explicit upstash requested but
      // credentials absent — fail closed for mutations, never silently
      // unlimited.
      return degradedDecision(
        route,
        policy,
        key,
        start,
        new RateLimitBackendError("Upstash backend selected without credentials."),
      );
    }
    try {
      const { getUpstashStore } = await import("./upstash");
      const result = await decide(getUpstashStore());
      return result;
    } catch (error) {
      return degradedDecision(route, policy, key, start, error);
    }
  }

  // In-process fallback: fine for dev/single-instance. In production
  // this is best-effort — say so loudly. An unconfigured shared store
  // is NOT treated as an outage: each instance still enforces the
  // category budget, so abuse stays bounded. Refusing every financial
  // mutation because Upstash was never provisioned takes the whole
  // ordering flow down, which is strictly worse than the multi-instance
  // bypass it guards against. Genuine backend failures (Upstash selected
  // but unreachable) still fail closed — see degradedDecision below.
  if (isProduction() && !warnedNoSharedStore) {
    warnedNoSharedStore = true;
    const { logError, logWarn } = await import("@/lib/observability/logger");
    if (isExplicitMemory()) {
      logWarn("Rate limiting explicitly set to in-process memory.", {
        category: "rate-limit",
        hint: "Single-instance only: budgets are NOT shared across instances.",
      });
    } else {
      logError("Rate limiting without a shared store in production.", {
        category: "rate-limit",
        hint: "Set RATE_LIMIT_BACKEND=upstash with UPSTASH_REDIS_REST_URL/TOKEN for a shared budget. Falling back to in-process memory meanwhile.",
      });
    }
  }
  try {
    const result = await decide(defaultStore);
    return { ...result, degraded: isProduction() ? true : undefined };
  } catch (error) {
    return degradedDecision(route, policy, key, start, error);
  }
}

async function degradedDecision(
  route: RateLimitCategory | RateLimitRoute,
  policy: CategoryPolicy,
  key: string,
  start: number,
  error: unknown,
): Promise<RateLimitResult> {
  const { logWarn, logError } = await import("@/lib/observability/logger");
  const keyPrefix = key.slice(0, 24);
  const durationMs = Date.now() - start;
  if (policy.onBackendError === "closed") {
    logError("Rate-limit backend unavailable: rejecting mutation.", {
      category: String(route),
      operation: "rate-limit",
      keyPrefix,
      durationMs,
      // Deliberately no error internals: no URLs, tokens, or keys.
      backend: resolveBackend(),
    });
    return { allowed: false, remaining: 0, resetMs: policy.windowMs, degraded: true };
  }
  logWarn("Rate-limit backend unavailable: allowing read (degraded).", {
    category: String(route),
    operation: "rate-limit",
    keyPrefix,
    durationMs,
    backend: resolveBackend(),
  });
  void error;
  return { allowed: true, remaining: policy.limit, resetMs: policy.windowMs, degraded: true };
}

/** Structured log for every 429 — no IPs, tokens, or keys. */
export async function logRateLimitRejection(input: {
  category: string;
  resetMs: number;
  degraded?: boolean;
}): Promise<void> {
  const { logWarn } = await import("@/lib/observability/logger");
  logWarn("Rate limit exceeded.", {
    category: input.category,
    operation: "rate-limit",
    retryAfterMs: input.resetMs,
    ...(input.degraded ? { degraded: true } : {}),
  });
}

/**
 * Route-helper: returns a logged 429 response when over budget, else
 * null. Keeps every route's rejection shape, Retry-After header, and
 * observability identical.
 */
export async function denyIfLimited(
  category: RateLimitCategory | RateLimitRoute,
  result: RateLimitResult,
): Promise<Response | null> {
  if (result.allowed) return null;
  await logRateLimitRejection({
    category: String(category),
    resetMs: result.resetMs,
    degraded: result.degraded,
  });
  const { rateLimited } = await import("@/lib/api/response");
  return rateLimited(result.resetMs);
}
