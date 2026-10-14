import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

const REQUEST_ID_HEADER = "x-request-id";
const RESPONSE_ID_HEADER = "x-request-id";

function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `req_${timestamp}_${random}`;
}

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestId(): string {
  const ctx = storage.getStore();
  if (ctx) return ctx.requestId;
  return generateRequestId();
}

export function setRequestId(id: string): void {
  storage.enterWith({ requestId: id });
}

export function runWithRequestId<T>(id: string, fn: () => T): T {
  return storage.run({ requestId: id }, fn);
}

export function responseHeaders(): HeadersInit {
  const ctx = storage.getStore();
  if (ctx) {
    return { [RESPONSE_ID_HEADER]: ctx.requestId };
  }
  return { [RESPONSE_ID_HEADER]: generateRequestId() };
}

export const REQUEST_ID_HEADER_NAME = REQUEST_ID_HEADER;
export const RESPONSE_ID_HEADER_NAME = RESPONSE_ID_HEADER;
