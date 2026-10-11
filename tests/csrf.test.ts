import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withErrorHandling } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";

/**
 * CSRF regression: cookie-authenticated mutations must reject
 * cross-origin callers even when the browser attaches credentials.
 * `withErrorHandling` is the single API edge every route goes through,
 * so the check is proven there once.
 */

let calls = 0;
const handler = withErrorHandling(async (req: Request) => {
  calls += 1;
  return ok({ method: req.method });
});

function post(origin?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin !== undefined) headers["Origin"] = origin;
  return new Request("http://localhost:3000/api/admin/products", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "x" }),
  });
}

describe("cross-origin (CSRF) protection on mutating requests", () => {
  it("rejects a foreign Origin without invoking the route", async () => {
    calls = 0;
    const res = await handler(post("https://evil.example"));
    expect(res.status).toBe(403);
    expect(calls).toBe(0);
    const body = (await res.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("rejects an opaque Origin (null)", async () => {
    calls = 0;
    const res = await handler(post("null"));
    expect(res.status).toBe(403);
    expect(calls).toBe(0);
  });

  it("allows a same-origin mutation", async () => {
    calls = 0;
    const res = await handler(post("http://localhost:3000"));
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("allows non-browser callers that send no Origin (server-to-server, tests)", async () => {
    calls = 0;
    const res = await handler(post());
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("never blocks safe methods, even with a foreign Origin", async () => {
    calls = 0;
    const res = await handler(
      new Request("http://localhost:3000/api/admin/orders", {
        headers: { Origin: "https://evil.example" },
      }),
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("honours x-forwarded-host behind a proxy", async () => {
    calls = 0;
    const allowed = await handler(
      new Request("http://internal:3000/api/admin/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://app.trolift.example",
          "x-forwarded-host": "app.trolift.example",
          host: "internal:3000",
        },
        body: JSON.stringify({ name: "x" }),
      }),
    );
    expect(allowed.status).toBe(200);
    const denied = await handler(
      new Request("http://internal:3000/api/admin/products", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
          "x-forwarded-host": "app.trolift.example",
          host: "internal:3000",
        },
        body: JSON.stringify({ name: "x" }),
      }),
    );
    expect(denied.status).toBe(403);
  });
});
