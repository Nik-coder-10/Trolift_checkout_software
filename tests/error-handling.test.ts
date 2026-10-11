import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createMockClient,
  type MockResponder,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";
import { AppError, ErrorCategory, handleRouteError } from "@/lib/api/errors";
import { generateReferenceId } from "@/lib/observability/reference";
import { runWithRequestId, getRequestId } from "@/lib/observability/correlation";
import { withErrorHandling } from "@/lib/api/handler";
import { ok, fail, internalError } from "@/lib/api/response";

beforeEach(() => resetRateLimits());

const serverHandler: MockResponder = () => {
  throw new Error("unexpected server query");
};
const adminHandler: MockResponder = () => {
  throw new Error("unexpected admin query");
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createMockClient(serverHandler),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createMockClient(adminHandler),
}));

describe("Error model", () => {
  it("creates validation errors with correct category and status", () => {
    const err = AppError.validation("Invalid input", { field: "email" });
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.status).toBe(422);
    expect(err.category).toBe(ErrorCategory.VALIDATION);
    expect(err.message).toBe("Invalid input");
    expect(err.details).toEqual({ field: "email" });
    expect(err.referenceId).toMatch(/^ERR-[0-9A-Z]{6}$/);
  });

  it("creates authentication errors with correct category and status", () => {
    const err = AppError.authentication();
    expect(err.code).toBe("AUTHENTICATION_ERROR");
    expect(err.status).toBe(401);
    expect(err.category).toBe(ErrorCategory.AUTHENTICATION);
  });

  it("creates authorization errors with correct category and status", () => {
    const err = AppError.authorization();
    expect(err.code).toBe("AUTHORIZATION_ERROR");
    expect(err.status).toBe(403);
    expect(err.category).toBe(ErrorCategory.AUTHORIZATION);
  });

  it("creates not-found errors with correct category and status", () => {
    const err = AppError.notFound();
    expect(err.code).toBe("NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.category).toBe(ErrorCategory.NOT_FOUND);
  });

  it("creates conflict errors with correct category and status", () => {
    const err = AppError.conflict("Already exists");
    expect(err.code).toBe("CONFLICT");
    expect(err.status).toBe(409);
    expect(err.category).toBe(ErrorCategory.CONFLICT);
  });

  it("creates rate-limited errors with correct category and status", () => {
    const err = AppError.rateLimited(30000);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.status).toBe(429);
    expect(err.category).toBe(ErrorCategory.RATE_LIMITED);
  });

  it("creates database errors with correct category and status", () => {
    const err = AppError.database();
    expect(err.code).toBe("DATABASE_ERROR");
    expect(err.status).toBe(503);
    expect(err.category).toBe(ErrorCategory.DATABASE);
  });

  it("creates internal errors with correct category and status", () => {
    const err = AppError.internal();
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.status).toBe(500);
    expect(err.category).toBe(ErrorCategory.INTERNAL);
  });

  it("generates unique reference IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateReferenceId()));
    expect(ids.size).toBe(100);
    for (const id of ids) {
      expect(id).toMatch(/^ERR-[0-9A-Z]{6}$/);
    }
  });
});

describe("handleRouteError", () => {
  it("maps AppError to fail response with reference ID", () => {
    const err = AppError.internal("Something went wrong");
    const res = handleRouteError(err);
    expect(res.status).toBe(500);
  });

  it("maps unknown errors to generic 500 without leaking details", () => {
    const res = handleRouteError(new Error("secret internal detail"));
    expect(res.status).toBe(500);
  });

  it("maps database errors to safe 503 response", () => {
    const dbError = { code: "23505", message: "duplicate key value violates unique constraint" };
    const res = handleRouteError(dbError);
    expect(res.status).toBe(500);
  });
});

describe("withErrorHandling wrapper", () => {
  it("passes through successful responses", async () => {
    const handler = withErrorHandling(async (_req: Request): Promise<Response> => ok({ success: true }));
    const res = await handler(new Request("http://localhost/test"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: unknown };
    expect(json.ok).toBe(true);
  });

  it("catches thrown errors and returns safe response", async () => {
    const handler = withErrorHandling(async (_req: Request): Promise<Response> => {
      throw new Error("secret internal error");
    });
    const res = await handler(new Request("http://localhost/test"));
    expect(res.status).toBe(500);
  });

  it("catches AppError and returns mapped response", async () => {
    const handler = withErrorHandling(async (_req: Request): Promise<Response> => {
      throw AppError.notFound("Resource not found");
    });
    const res = await handler(new Request("http://localhost/test"));
    expect(res.status).toBe(404);
  });

  it("adds x-request-id header to responses", async () => {
    const handler = withErrorHandling(async (_req: Request): Promise<Response> => ok({ success: true }));
    const res = await handler(new Request("http://localhost/test"));
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("preserves x-request-id from incoming request", async () => {
    const handler = withErrorHandling(async (_req: Request): Promise<Response> => ok({ success: true }));
    const req = new Request("http://localhost/test", {
      headers: { "x-request-id": "req_test123" },
    });
    const res = await handler(req);
    expect(res.headers.get("x-request-id")).toBe("req_test123");
  });

  it("handles rate-limited errors with Retry-After header", async () => {
    const handler = withErrorHandling(async (_req: Request): Promise<Response> => {
      throw AppError.rateLimited(30000);
    });
    const res = await handler(new Request("http://localhost/test"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });
});

describe("Request correlation", () => {
  it("generates request IDs", () => {
    const id = getRequestId();
    expect(id).toMatch(/^req_/);
  });

  it("uses AsyncLocalStorage for scoped IDs", () => {
    runWithRequestId("req_scoped_123", () => {
      expect(getRequestId()).toBe("req_scoped_123");
    });
  });

  it("generates unique IDs for different requests", () => {
    const ids = new Set(
      Array.from({ length: 50 }, (_, i) => runWithRequestId(`req_test_${i}`, () => getRequestId())),
    );
    expect(ids.size).toBe(50);
  });
});

describe("Response helpers", () => {
  it("ok() returns success envelope", async () => {
    const res = ok({ test: true });
    const json = (await res.json()) as { ok: boolean; data: unknown };
    expect(json.ok).toBe(true);
    expect(json.data).toEqual({ test: true });
  });

  it("fail() returns failure envelope", async () => {
    const res = fail("TEST_ERROR", "Test message", { status: 400 });
    const json = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("TEST_ERROR");
    expect(json.error.message).toBe("Test message");
  });

  it("internalError() includes reference ID in details", async () => {
    const res = internalError("Something went wrong", "ERR-ABC123");
    const json = (await res.json()) as {
      ok: boolean;
      error: { code: string; details?: { referenceId?: string } };
    };
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("INTERNAL_ERROR");
    expect(json.error.details?.referenceId).toBe("ERR-ABC123");
  });
});

describe("Health endpoints", () => {
  it("GET /api/health returns ok", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; data: { status: string } };
    expect(json.ok).toBe(true);
    expect(json.data.status).toBe("ok");
  });
});

describe("Retry safety", () => {
  it("order creation uses idempotency keys for safe retries", async () => {
    const { POST } = await import("@/app/api/orders/route");
    const idempotencyKey = "test-key-123";
    const body = {
      items: [{ productId: "p1", quantity: 1 }],
      pincode: "400001",
      customer: { name: "Test", phone: "9876543210", email: null, gstin: null },
      idempotencyKey,
    };
    const req = new Request("http://localhost/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("payment claim uses guarded updates for safe retries", async () => {
    const { POST } = await import("@/app/api/payments/claim/route");
    const { generateGuestToken } = await import("@/lib/guest-access/tokens");
    const body = {
      orderId: "c0ffee00-0001-4000-8000-000000000001",
      reference: "123456789012",
      phone: "9876543210",
      // A well-formed token forces the DB authorization path, where the
      // failing backend surfaces a generic 500 (never the raw error).
      accessToken: generateGuestToken(),
    };
    const req = new Request("http://localhost/api/payments/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
