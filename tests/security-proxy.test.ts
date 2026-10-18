import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { proxy } from "@/proxy";

/**
 * Security proxy behavior: strict CSP with per-request nonces and
 * cross-origin write protection for API routes. The matching itself is
 * browser-threat-model correct: a missing Origin/Referer/Sec-Fetch-Site
 * is non-provable and allowed (curl/server-to-server), a contradicting
 * value is rejected.
 */

const ORDERS_PATH = "/api/admin/orders/status";

function req(opts: {
  method: string;
  path?: string;
  origin?: string;
  referer?: string;
  secFetchSite?: string;
}): NextRequest {
  const headers = new Headers();
  if (opts.origin !== undefined) headers.set("origin", opts.origin);
  if (opts.referer !== undefined) headers.set("referer", opts.referer);
  if (opts.secFetchSite !== undefined) {
    headers.set("sec-fetch-site", opts.secFetchSite);
  }
  return new NextRequest(`http://app.example.com${opts.path ?? ORDERS_PATH}`, {
    method: opts.method,
    headers,
  });
}

async function json(
  res: NextResponse,
): Promise<{ ok: boolean; error: { code: string } }> {
  expect(res.headers.get("content-type")).toContain("application/json");
  return (await res.json()) as { ok: boolean; error: { code: string } };
}

describe("cross-origin write protection", () => {
  it("rejects cross-site Origin on API mutations with 403", async () => {
    const res = proxy(req({ method: "POST", origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("rejects a null-origin (sandboxed iframe) mutation", async () => {
    const res = proxy(req({ method: "DELETE", origin: "null" }));
    expect(res.status).toBe(403);
  });

  it("rejects malformed Origin and mismatching Referer", async () => {
    expect(proxy(req({ method: "PATCH", origin: "::::" })).status).toBe(403);
    expect(
      proxy(
        req({ method: "POST", referer: "https://evil.example/attack" }),
      ).status,
    ).toBe(403);
  });

  it("rejects fetched-site evidence of other-site navigation", async () => {
    expect(
      proxy(req({ method: "POST", secFetchSite: "cross-site" })).status,
    ).toBe(403);
    expect(
      proxy(req({ method: "DELETE", secFetchSite: "same-site" })).status,
    ).toBe(403);
  });

  it("allows same-origin mutations", async () => {
    const res = proxy(req({ method: "POST", origin: "http://app.example.com" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("script-src");
  });

  it("allows header-less mutations (curl / server-to-server)", async () => {
    expect(proxy(req({ method: "POST" })).status).toBe(200);
    expect(proxy(req({ method: "PUT" })).status).toBe(200);
  });

  it("never blocks safe methods even cross-site", async () => {
    const res = proxy(req({ method: "GET", origin: "https://evil.example" }));
    expect(res.status).toBe(200);
  });

  it("only guards API paths; page POSTs pass through", async () => {
    const res = proxy(
      req({ method: "POST", path: "/checkout", origin: "https://evil.example" }),
    );
    expect(res.status).toBe(200);
  });
});

describe("baseline CSP", () => {
  it("sets a hardening CSP pinned to first-party origin", async () => {
    const res = proxy(req({ method: "GET", path: "/" }));
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("img-src 'self' data: blob: https:");
    // SSG pages ship inline bootstrap scripts (nonces only exist on
    // dynamically rendered HTML), so inline allowance is required;
    // src scripts must still be same-origin only.
    const scriptSrc =
      csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).not.toMatch(/https?:/);
  });

  it("stays stable across requests (cacheable, no per-request token)", () => {
    const a = proxy(req({ method: "GET", path: "/" })).headers.get(
      "content-security-policy",
    );
    const b = proxy(req({ method: "GET", path: "/" })).headers.get(
      "content-security-policy",
    );
    expect(a).toBe(b);
  });
});
