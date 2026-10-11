import { handleRouteError } from "@/lib/api/errors";
import { forbidden } from "@/lib/api/response";
import { responseHeaders, setRequestId } from "@/lib/observability/correlation";
import { logApiRequest, logError } from "@/lib/observability/logger";

/* eslint-disable @typescript-eslint/no-explicit-any */

function extractRoute(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for state-changing requests.
 *
 * Admin mutations authenticate with session COOKIES, so a cross-site
 * form/fetch must never be able to drive them. SameSite=Lax cookies
 * already block most of this, but that attribute is a property of the
 * auth cookie — a defence-in-depth check at the API edge keeps the
 * protection even if a cookie is ever issued with different options.
 *
 * Rules (deliberately permissive where it cannot hurt):
 *   - safe methods are never checked;
 *   - a request with NO Origin header is allowed (server-to-server
 *     calls, curl, tests and native clients do not send one — and a
 *     browser always does for cross-site writes);
 *   - Origin must equal the request host (port included). An opaque
 *     `Origin: null` (sandboxed/redirected contexts) is rejected.
 */
function crossOriginRejection(req: Request): Response | null {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return null;
  const origin = req.headers.get("origin");
  if (origin === null) return null;
  if (origin === "null") {
    return forbidden("Cross-origin requests are not allowed.");
  }
  // Any of the host facts the platform gives us is enough: the proxy
  // header, the Host header, or the URL itself (some runtimes strip
  // Host from the Request object). A foreign Origin matches none.
  const candidates = [
    req.headers.get("x-forwarded-host"),
    req.headers.get("host"),
    (() => {
      try {
        return new URL(req.url).host;
      } catch {
        return null;
      }
    })(),
  ]
    .filter((h): h is string => typeof h === "string" && h.trim() !== "")
    .map((h) => (h.split(",")[0] ?? "").trim().toLowerCase());
  if (candidates.length === 0) return null;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    if (candidates.includes(originHost)) return null;
  } catch {
    // Unparseable Origin — fall through to rejection.
  }
  return forbidden("Cross-origin requests are not allowed.");
}

function addCorrelationHeader(response: Response): Response {
  const headers = new Headers(response.headers);
  const correlationHeaders = responseHeaders();
  for (const [key, value] of Object.entries(correlationHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function withErrorHandling<T extends (req: Request, ctx?: any) => Promise<Response>>(
  handler: T,
): T {
  return (async (req: Request, ctx?: any) => {
    const startTime = Date.now();
    const route = extractRoute(req.url);
    const method = req.method;

    const incomingRequestId = req.headers.get("x-request-id");
    if (incomingRequestId && incomingRequestId.length > 0 && incomingRequestId.length <= 128) {
      setRequestId(incomingRequestId);
    }

    const rejected = crossOriginRejection(req);
    if (rejected !== null) {
      const durationMs = Date.now() - startTime;
      logApiRequest({ route, method, statusCode: rejected.status, durationMs });
      return addCorrelationHeader(rejected);
    }

    try {
      const response = ctx !== undefined
        ? await handler(req, ctx)
        : await handler(req);

      const durationMs = Date.now() - startTime;
      logApiRequest({
        route,
        method,
        statusCode: response.status,
        durationMs,
      });

      return addCorrelationHeader(response);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const referenceId =
        error instanceof Error && "referenceId" in error
          ? (error as { referenceId: string }).referenceId
          : undefined;

      logError("Unhandled route error", {
        route,
        method,
        durationMs,
        errorCategory:
          error instanceof Error && "category" in error
            ? (error as { category: string }).category
            : undefined,
        referenceId,
      });

      const response = handleRouteError(error);
      return addCorrelationHeader(response);
    }
  }) as T;
}
