import "server-only";
import type { RateLimitOptions, RateLimitResult, RateLimitStore } from "./index";
import { RateLimitBackendError } from "./index";

/**
 * Shared sliding-window rate limiting over Upstash Redis (server-only).
 *
 * - Atomicity: one Lua script does prune → count → admit + expire, so
 *   concurrent instances share a single exact budget.
 * - Transport: Upstash HTTPS API (`POST {url}/eval/...`) with the REST
 *   token in the Authorization header — both server-only env vars, never
 *   `NEXT_PUBLIC_`, never logged, never returned to clients.
 * - Timeout: every call races an AbortSignal timeout (default 1500 ms,
 *   `RATE_LIMIT_UPSTREAM_TIMEOUT_MS`); slowness degrades to the
 *   category policy in `checkRateLimit`, never a hung request.
 *
 * LIVE STATUS: mock-tested only (see tests/rate-limit-distributed.test.ts).
 * Do NOT claim distributed production protection until this adapter has
 * been exercised against a real Upstash instance.
 */

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset = window
  if #oldest >= 2 then
    reset = tonumber(oldest[2]) + window - now
    if reset < 0 then reset = 0 end
  end
  return {0, reset}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, window, count + 1}
`.trim();

export function slidingWindowScript(): string {
  return SLIDING_WINDOW_LUA;
}

export function upstreamTimeoutMs(): number {
  const raw = Number(process.env.RATE_LIMIT_UPSTREAM_TIMEOUT_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1500;
}

function restConfig(): { url: string; token: string } {
  const url = (process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  if (url === "" || token === "") {
    throw new RateLimitBackendError("Upstash credentials are not configured.");
  }
  return { url, token };
}

type FetchFn = typeof fetch;

let shared: UpstashRateLimitStore | null = null;

/** Process-wide singleton (one HTTPS client per instance). */
export function getUpstashStore(fetchFn?: FetchFn): UpstashRateLimitStore {
  if (fetchFn) return new UpstashRateLimitStore(fetchFn);
  if (!shared) shared = new UpstashRateLimitStore();
  return shared;
}

/** Test hook: drop the singleton between cases. */
export function resetUpstashStore(): void {
  shared = null;
}

export class UpstashRateLimitStore implements RateLimitStore {
  private readonly fetchFn: FetchFn;

  constructor(fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? fetch;
  }

  async check(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
    const { url, token } = restConfig();
    const now = Date.now();
    const member = `${now}:${Math.random().toString(36).slice(2, 12)}`;
    const path = [
      "eval",
      encodeURIComponent(SLIDING_WINDOW_LUA),
      "1",
      encodeURIComponent(key),
      String(now),
      String(opts.windowMs),
      String(opts.limit),
      encodeURIComponent(member),
    ].join("/");
    const timeout = upstreamTimeoutMs();
    let res: Response;
    try {
      res = await this.fetchFn(`${url}/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      throw new RateLimitBackendError(
        error instanceof Error && error.name === "TimeoutError"
          ? `Upstash request timed out after ${timeout}ms.`
          : "Upstash request failed.",
      );
    }
    if (!res.ok) {
      throw new RateLimitBackendError("Upstash request failed.");
    }
    let payload: unknown;
    try {
      payload = (await res.json()) as unknown;
    } catch {
      throw new RateLimitBackendError("Upstash returned an unreadable response.");
    }
    const result =
      typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>)["result"]
        : undefined;
    if (!Array.isArray(result) || result.length < 2) {
      if (
        typeof payload === "object" && payload !== null &&
        "error" in (payload as Record<string, unknown>)
      ) {
        throw new RateLimitBackendError("Upstash request failed.");
      }
      throw new RateLimitBackendError("Upstash returned an unreadable response.");
    }
    const [allowedFlag, resetRaw, countRaw] = result as [unknown, unknown, unknown];
    const resetMs =
      typeof resetRaw === "number" && Number.isFinite(resetRaw)
        ? Math.max(0, Math.floor(resetRaw))
        : opts.windowMs;
    if (allowedFlag === 1) {
      const used =
        typeof countRaw === "number" && Number.isFinite(countRaw)
          ? Math.floor(countRaw)
          : 1;
      return { allowed: true, remaining: Math.max(0, opts.limit - used), resetMs };
    }
    return { allowed: false, remaining: 0, resetMs };
  }

  async reset(): Promise<void> {
    // Deliberately unsupported: wiping shared production counters from
    // app code would be a footgun. Tests use isolated key prefixes.
  }
}
