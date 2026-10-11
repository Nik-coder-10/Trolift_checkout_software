import { NextResponse } from "next/server";
import type { ApiFailure, ApiSuccess } from "@/types/api";

export function ok<T>(data: T, init?: { status?: number }): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true, data }, { status: init?.status ?? 200 });
}

export function fail(
  code: string,
  message: string,
  init?: { status?: number; details?: unknown; headers?: HeadersInit },
): NextResponse<ApiFailure> {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        ...(init?.details !== undefined ? { details: init.details } : {}),
      },
    },
    { status: init?.status ?? 400, headers: init?.headers },
  );
}

export const badRequest = (message = "Invalid request.", details?: unknown) =>
  fail("BAD_REQUEST", message, { status: 400, details });

export const unauthorized = (message = "Authentication required.") =>
  fail("UNAUTHORIZED", message, { status: 401 });

export const forbidden = (message = "You do not have access to this resource.") =>
  fail("FORBIDDEN", message, { status: 403 });

export const notFound = (message = "Resource not found.") =>
  fail("NOT_FOUND", message, { status: 404 });

export const unprocessable = (message: string, details?: unknown) =>
  fail("VALIDATION_ERROR", message, { status: 422, details });

export const internalError = (
  message = "Something went wrong. Please try again.",
  referenceId?: string,
) =>
  fail("INTERNAL_ERROR", message, {
    status: 500,
    details: referenceId ? { referenceId } : undefined,
  });

export function rateLimited(retryAfterMs: number): NextResponse<ApiFailure> {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again shortly.",
      },
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
      },
    },
  );
}
