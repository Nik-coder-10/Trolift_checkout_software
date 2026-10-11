import { ok } from "@/lib/api/response";
import { AppError } from "@/lib/api/errors";
import { withErrorHandling } from "@/lib/api/handler";
import { checkRateLimit, denyIfLimited } from "@/lib/rate-limit/index";
import {
  createStaffNote,
  deleteStaffNote,
  listStaffNotes,
  updateStaffNote,
} from "@/lib/admin/notes";

/**
 * /api/admin/notes — internal staff notes (admins only).
 *
 * GET    ?entityType=order|customer|product&entityId=<uuid>
 * POST   { entityType, entityId, body }
 * PATCH  { noteId, body }
 * DELETE ?id=<note uuid>
 *
 * Every handler delegates to lib/admin/notes.ts, which starts with
 * requireAdmin(); the table's RLS independently enforces is_admin().
 * Anonymous or non-admin callers get 401/403 — never data.
 */

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)
    : {};
}

export const GET = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const url = new URL(req.url);
  // Authorization lives in listStaffNotes and runs BEFORE parameter
  // validation, so a guest learns nothing — not even whether the
  // query shape was valid (they get 401, never 400).
  const notes = await listStaffNotes(
    (url.searchParams.get("entityType") ?? "") as "order",
    url.searchParams.get("entityId") ?? "",
  );
  return ok({ notes });
});

export const POST = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.", 400);
  }
  const record = asRecord(body);
  // The author is taken from the authenticated admin session inside
  // createStaffNote — never from the request body.
  const note = await createStaffNote({
    entityType: record["entityType"] as "order",
    entityId: String(record["entityId"] ?? ""),
    body: String(record["body"] ?? ""),
  });
  return ok({ note });
});

export const PATCH = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  let body: unknown;
  try {
    body = (await req.json()) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be JSON.", 400);
  }
  const record = asRecord(body);
  const note = await updateStaffNote({
    noteId: String(record["noteId"] ?? ""),
    body: String(record["body"] ?? ""),
  });
  return ok({ note });
});

export const DELETE = withErrorHandling(async (req: Request) => {
  const denied = await denyIfLimited("admin", await checkRateLimit(req, "admin"));
  if (denied) return denied;
  const url = new URL(req.url);
  await deleteStaffNote(url.searchParams.get("id") ?? "");
  return ok({ deleted: true });
});
