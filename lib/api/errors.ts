import { fail, internalError } from "@/lib/api/response";
import { generateReferenceId } from "@/lib/observability/reference";
import { logError } from "@/lib/observability/logger";

export const ErrorCategory = {
  VALIDATION: "VALIDATION_ERROR",
  AUTHENTICATION: "AUTHENTICATION_ERROR",
  AUTHORIZATION: "AUTHORIZATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  DATABASE: "DATABASE_ERROR",
  INTERNAL: "INTERNAL_ERROR",
} as const;

export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

const CATEGORY_STATUS: Record<ErrorCategory, number> = {
  [ErrorCategory.VALIDATION]: 422,
  [ErrorCategory.AUTHENTICATION]: 401,
  [ErrorCategory.AUTHORIZATION]: 403,
  [ErrorCategory.NOT_FOUND]: 404,
  [ErrorCategory.CONFLICT]: 409,
  [ErrorCategory.RATE_LIMITED]: 429,
  [ErrorCategory.SERVICE_UNAVAILABLE]: 503,
  [ErrorCategory.DATABASE]: 503,
  [ErrorCategory.INTERNAL]: 500,
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly category: ErrorCategory;
  readonly referenceId: string;

  constructor(
    code: string,
    message: string,
    status = 400,
    details?: unknown,
    category: ErrorCategory = ErrorCategory.VALIDATION,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.category = category;
    this.referenceId = generateReferenceId();
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError(
      "VALIDATION_ERROR",
      message,
      CATEGORY_STATUS[ErrorCategory.VALIDATION],
      details,
      ErrorCategory.VALIDATION,
    );
  }

  static authentication(message = "Authentication required."): AppError {
    return new AppError(
      "AUTHENTICATION_ERROR",
      message,
      CATEGORY_STATUS[ErrorCategory.AUTHENTICATION],
      undefined,
      ErrorCategory.AUTHENTICATION,
    );
  }

  static authorization(message = "You do not have access to this resource."): AppError {
    return new AppError(
      "AUTHORIZATION_ERROR",
      message,
      CATEGORY_STATUS[ErrorCategory.AUTHORIZATION],
      undefined,
      ErrorCategory.AUTHORIZATION,
    );
  }

  static notFound(message = "Resource not found."): AppError {
    return new AppError(
      "NOT_FOUND",
      message,
      CATEGORY_STATUS[ErrorCategory.NOT_FOUND],
      undefined,
      ErrorCategory.NOT_FOUND,
    );
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError(
      "CONFLICT",
      message,
      CATEGORY_STATUS[ErrorCategory.CONFLICT],
      details,
      ErrorCategory.CONFLICT,
    );
  }

  static rateLimited(retryAfterMs: number): AppError {
    const err = new AppError(
      "RATE_LIMITED",
      "Too many requests. Please try again shortly.",
      CATEGORY_STATUS[ErrorCategory.RATE_LIMITED],
      undefined,
      ErrorCategory.RATE_LIMITED,
    );
    (err as unknown as { retryAfterMs: number }).retryAfterMs = retryAfterMs;
    return err;
  }

  static serviceUnavailable(message = "Service temporarily unavailable. Please try again."): AppError {
    return new AppError(
      "SERVICE_UNAVAILABLE",
      message,
      CATEGORY_STATUS[ErrorCategory.SERVICE_UNAVAILABLE],
      undefined,
      ErrorCategory.SERVICE_UNAVAILABLE,
    );
  }

  static database(message = "A database error occurred. Please try again."): AppError {
    return new AppError(
      "DATABASE_ERROR",
      message,
      CATEGORY_STATUS[ErrorCategory.DATABASE],
      undefined,
      ErrorCategory.DATABASE,
    );
  }

  static internal(message = "Something went wrong. Please try again."): AppError {
    return new AppError(
      "INTERNAL_ERROR",
      message,
      CATEGORY_STATUS[ErrorCategory.INTERNAL],
      undefined,
      ErrorCategory.INTERNAL,
    );
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function handleRouteError(error: unknown) {
  if (error instanceof AppError) {
    const init: { status: number; details?: unknown } = {
      status: error.status,
    };
    if (error.details !== undefined) {
      init.details = error.details;
    }
    if (error.category === ErrorCategory.RATE_LIMITED) {
      const retryAfterMs = (error as unknown as { retryAfterMs?: number }).retryAfterMs;
      if (retryAfterMs !== undefined) {
        return fail(error.code, error.message, {
          status: error.status,
          details: error.details,
          headers: {
            "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
          },
        });
      }
    }
    return fail(error.code, error.message, init);
  }
  const referenceId = generateReferenceId();
  // Never log the raw error object: messages, stacks, and attached
  // details can carry secrets, tokens, or personal data (database
  // errors, for example, echo bound values). The error class plus the
  // reference ID preserve triage context — the request-scoped log line
  // in withErrorHandling() already records route, method, and timing
  // under the same correlation ID.
  logError("Unhandled route error", {
    errorCategory: ErrorCategory.INTERNAL,
    referenceId,
    errorName: error instanceof Error ? error.name : typeof error,
  });
  return internalError("Something went wrong. Please try again.", referenceId);
}
