import { getRequestId } from "@/lib/observability/correlation";

export const LogLevel = {
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error",
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  requestId: string;
  message: string;
  route?: string;
  operation?: string;
  orderId?: string;
  statusCode?: number;
  durationMs?: number;
  errorCategory?: string;
  [key: string]: unknown;
}

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "session",
  "credit_card",
  "card_number",
  "cvv",
  "ssn",
  "service_role",
  "service_role_key",
  "supabase_service_role_key",
  "access_token",
  "refresh_token",
  "id_token",
  "private_key",
  "client_secret",
]);

function sanitizeValue(key: string, value: unknown): unknown {
  const lowerKey = key.toLowerCase();
  for (const sensitive of SENSITIVE_KEYS) {
    if (lowerKey.includes(sensitive)) {
      return "[REDACTED]";
    }
  }
  if (typeof value === "string") {
    if (value.length > 500) {
      return value.slice(0, 500) + "...";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeValue(key, v));
  }
  if (typeof value === "object" && value !== null) {
    return sanitizeObject(value as Record<string, unknown>);
  }
  return value;
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = sanitizeValue(key, value);
  }
  return result;
}

function createEntry(
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    requestId: getRequestId(),
    message,
  };
  if (fields) {
    const sanitized = sanitizeObject(fields);
    Object.assign(entry, sanitized);
  }
  return entry;
}

function output(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  switch (entry.level) {
    case LogLevel.ERROR:
      console.error(line);
      break;
    case LogLevel.WARN:
      console.warn(line);
      break;
    case LogLevel.DEBUG:
      console.debug(line);
      break;
    default:
      console.log(line);
  }
}

export function logDebug(message: string, fields?: Record<string, unknown>): void {
  output(createEntry(LogLevel.DEBUG, message, fields));
}

export function logInfo(message: string, fields?: Record<string, unknown>): void {
  output(createEntry(LogLevel.INFO, message, fields));
}

export function logWarn(message: string, fields?: Record<string, unknown>): void {
  output(createEntry(LogLevel.WARN, message, fields));
}

export function logError(
  message: string,
  fields?: Record<string, unknown>,
): void {
  output(createEntry(LogLevel.ERROR, message, fields));
}

export function logApiRequest(fields: {
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
  operation?: string;
  orderId?: string;
  errorCategory?: string;
}): void {
  output(
    createEntry(
      fields.statusCode >= 500 ? LogLevel.ERROR : fields.statusCode >= 400 ? LogLevel.WARN : LogLevel.INFO,
      `API ${fields.method} ${fields.route} ${fields.statusCode}`,
      fields,
    ),
  );
}
