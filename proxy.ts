import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge proxy (Next 16 renamed middleware → proxy; same API).
 *
 * Two security layers live here, before any route/page code runs:
 *
 * 1. Baseline CSP (the Shopify-style "limit what a browser loads"
 *    hardening). Nonce-based 'strict-dynamic' was evaluated first and
 *    deliberately rejected: this storefront ships SSG pages (home, 18
 *    product pages, …), and nonces are stamped only during dynamic
 *    rendering — static HTML carries zero nonces, so strict-dynamic
 *    would block every Next script and kill hydration. The baseline
 *    instead pins first-party script/style media and fonts ('self'),
 *    permits the inline scripts/styles Next requires, whitelists only
 *    https: images (QR codes are data: blobs), and hard-denies
 *    framing, plugins, cross-origin forms and non-self connections —
 *    an injected third-party <script> from anywhere but the origin is
 *    dead on arrival.
 *
 * 2. Cross-origin write protection for API routes. Every modern
 *    browser stamps cross-site POSTs (and same-site-but-different
 *    origin) with an Origin/Referer revealing the initiator, and
 *    Sec-Fetch-Site with 'cross-site'/'same-site'. When any of those
 *    headers is present and contradicts our own origin we reject with
 *    403 before the request reaches auth or Supabase. Requests without
 *    them (curl, server-to-server, the vitest suite) still pass — CSRF
 *    is a *browser* threat model, and browsers always send these
 *    headers, so failing only on a *mismatching* value closes the
 *    browser attack without breaking non-browser clients. Session
 *    cookies remain SameSite=Lax as the second layer.
 */

const CSP_HEADERS = "Content-Security-Policy";

function buildCsp(dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** True when a header proves the request did not originate from us. */
function crossOriginEvidence(request: NextRequest): string | null {
  const own = request.nextUrl.host;
  const origin = request.headers.get("origin");
  if (origin !== null) {
    // "null" origin (sandboxed iframe / file://) can never be trusted.
    const mismatch =
      origin === "null" ||
      (() => {
        try {
          return new URL(origin).host !== own;
        } catch {
          return true;
        }
      })();
    if (mismatch) return "origin";
  }
  const referer = request.headers.get("referer");
  if (referer !== null) {
    const mismatch = (() => {
      try {
        return new URL(referer).host !== own;
      } catch {
        return true;
      }
    })();
    if (mismatch) return "referer";
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    fetchSite !== null &&
    fetchSite !== "" &&
    fetchSite !== "same-origin" &&
    fetchSite !== "none"
  ) {
    // same-site (e.g. sibling subdomain) also proves a foreign page —
    // anything short of same-origin is untrusted for mutations.
    return "sec-fetch-site";
  }
  return null;
}

export function proxy(request: NextRequest): NextResponse {
  const method = request.method.toUpperCase();
  const mutation = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (
    mutation &&
    request.nextUrl.pathname.startsWith("/api/") &&
    crossOriginEvidence(request) !== null
  ) {
    // Structured shape lib/api/response.fail() uses — kept inline so
    // this edge bundle stays dependency-free.
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Cross-origin request rejected.",
        },
      },
      { status: 403 },
    );
  }

  const csp = buildCsp(process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_HEADERS, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CSP_HEADERS, csp);
  return response;
}

export const config = {
  matcher: [
    // Keep the nonce off static assets (no HTML to embed it in) so the
    // proxy only pays its cost where it can reduce risk.
    "/((?!_next/static|_next/image|favicon\\.ico|images/|videos/|sitemap\\.xml|robots\\.txt).*)",
  ],
};
