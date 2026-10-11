import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import { AppError } from "@/lib/api/errors";
import { logAdminAudit } from "@/lib/admin/audit";

/**
 * Internal staff notes (server-only, admins only).
 *
 * Strictly admin/staff: every entry point starts with requireAdmin()
 * AND the table's RLS policies independently enforce public.is_admin()
 * (migration 0025), so authorization never depends on UI hiding or a
 * single code path. Notes attach ONLY to explicit entity types
 * ('order' | 'customer' | 'product') — a client can never name an
 * arbitrary table, and every entity id must be a real UUID that
 * resolves to an existing row of that type.
 *
 * Bodies are plain text: trimmed, control-character-stripped, capped
 * at 1000 chars. Stored raw, displayed through React text nodes
 * (escaped) — no HTML is ever stored or rendered, so XSS is handled
 * by construction. Note bodies are never written to the audit log.
 */

export const STAFF_NOTE_ENTITY_TYPES = ["order", "customer", "product"] as const;
export type StaffNoteEntityType = (typeof STAFF_NOTE_ENTITY_TYPES)[number];

export const STAFF_NOTE_MAX_LENGTH = 1000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ENTITY_TABLES: Record<StaffNoteEntityType, string> = {
  order: "orders",
  customer: "customers",
  product: "products",
};

export function isStaffNoteEntityType(v: unknown): v is StaffNoteEntityType {
  return (
    typeof v === "string" &&
    (STAFF_NOTE_ENTITY_TYPES as ReadonlyArray<string>).includes(v)
  );
}

export function isValidUuid(v: unknown): v is string {
  return (
    typeof v === "string" && v.length === 36 && UUID_PATTERN.test(v)
  );
}

/**
 * Sanitize a note body: accept strings only, normalize newlines, strip
 * control characters (keeping \n), trim. Returns null when nothing
 * usable remains. Deliberately does NOT slice — callers must reject
 * oversized payloads rather than silently truncate them.
 */
export function sanitizeNoteBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Normalize a note body for storage/display: sanitize then cap to the
 * length limit. Returns null when nothing usable remains.
 */
export function normalizeNoteBody(raw: unknown): string | null {
  const cleaned = sanitizeNoteBody(raw);
  return cleaned === null ? null : cleaned.slice(0, STAFF_NOTE_MAX_LENGTH);
}

/**
 * Parse + validate a user-supplied body for persistence.
 * Blank → 422; over the cap → 422 (never a silent truncation, so an
 * oversized payload cannot masquerade as a shorter note).
 */
function parseNoteBody(raw: unknown): string {
  const cleaned = sanitizeNoteBody(raw);
  if (cleaned === null) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Note text is required (1–${STAFF_NOTE_MAX_LENGTH} characters).`,
      422,
    );
  }
  if (cleaned.length > STAFF_NOTE_MAX_LENGTH) {
    throw new AppError(
      "VALIDATION_ERROR",
      `Note text must be at most ${STAFF_NOTE_MAX_LENGTH} characters.`,
      422,
    );
  }
  return cleaned;
}

export interface StaffNote {
  id: string;
  entityType: StaffNoteEntityType;
  entityId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

interface NoteRow {
  id: string;
  entity_type: string;
  entity_id: string;
  author_user_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

function toNote(r: NoteRow): StaffNote {
  return {
    id: r.id,
    entityType: r.entity_type as StaffNoteEntityType,
    entityId: r.entity_id,
    authorUserId: r.author_user_id,
    body: r.body,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function parseEntity(
  entityType: unknown,
  entityId: unknown,
): { entityType: StaffNoteEntityType; entityId: string } {
  if (!isStaffNoteEntityType(entityType)) {
    throw new AppError("BAD_REQUEST", "Unsupported note entity type.", 400);
  }
  if (!isValidUuid(entityId)) {
    throw new AppError("BAD_REQUEST", "A valid entity id is required.", 400);
  }
  return { entityType, entityId };
}

/** Fail closed if the note target no longer exists. */
async function assertEntityExists(
  entityType: StaffNoteEntityType,
  entityId: string,
): Promise<void> {
  const client = await createClient();
  const { data, error } = await client
    .from(ENTITY_TABLES[entityType])
    .select("id")
    .eq("id", entityId)
    .maybeSingle();
  if (error || !data) {
    throw new AppError("NOT_FOUND", `That ${entityType} does not exist.`, 404);
  }
}

export async function listStaffNotes(
  entityType: StaffNoteEntityType,
  entityId: string,
): Promise<StaffNote[]> {
  await requireAdmin();
  if (!isStaffNoteEntityType(entityType) || !isValidUuid(entityId)) {
    throw new AppError("BAD_REQUEST", "Unsupported note entity reference.", 400);
  }
  const client = await createClient();
  const { data, error } = await client
    .from("staff_notes")
    .select("id,entity_type,entity_id,author_user_id,body,created_at,updated_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not load notes.", 500);
  }
  return ((data ?? []) as unknown as NoteRow[]).map(toNote);
}

export async function createStaffNote(input: {
  entityType: StaffNoteEntityType;
  entityId: string;
  body: string;
}): Promise<StaffNote> {
  const admin = await requireAdmin();
  const { entityType, entityId } = parseEntity(input.entityType, input.entityId);
  const body = parseNoteBody(input.body);
  await assertEntityExists(entityType, entityId);

  const client = await createClient();
  const { data, error } = await client
    .from("staff_notes")
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      author_user_id: admin.id,
      body,
    })
    .select("id,entity_type,entity_id,author_user_id,body,created_at,updated_at")
    .single();
  if (error || !data) {
    // RLS rejection (non-admin) surfaces here too — fail closed.
    throw new AppError("INTERNAL_ERROR", "Could not save the note.", 500);
  }
  const note = toNote(data as unknown as NoteRow);
  await auditFor(admin.id, "note_created", entityType, entityId, note.id);
  return note;
}

export async function updateStaffNote(input: {
  noteId: string;
  body: string;
}): Promise<StaffNote> {
  const admin = await requireAdmin();
  if (!isValidUuid(input.noteId)) {
    throw new AppError("BAD_REQUEST", "A valid note id is required.", 400);
  }
  const body = parseNoteBody(input.body);
  const client = await createClient();
  const { data, error } = await client
    .from("staff_notes")
    .update({ body })
    .eq("id", input.noteId)
    .select("id,entity_type,entity_id,author_user_id,body,created_at,updated_at");
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not update the note.", 500);
  }
  const rows = (data ?? []) as unknown as NoteRow[];
  if (rows.length === 0) {
    throw new AppError("NOT_FOUND", "Note not found (it may have been deleted).", 404);
  }
  const note = toNote(rows[0]!);
  await auditFor(admin.id, "note_updated", note.entityType, note.entityId, note.id);
  return note;
}

export async function deleteStaffNote(noteId: string): Promise<void> {
  const admin = await requireAdmin();
  if (!isValidUuid(noteId)) {
    throw new AppError("BAD_REQUEST", "A valid note id is required.", 400);
  }
  const client = await createClient();
  // Capture entity context before the delete for the audit record.
  const { data: existing } = await client
    .from("staff_notes")
    .select("id,entity_type,entity_id")
    .eq("id", noteId)
    .maybeSingle();
  const row = existing as unknown as {
    id: string;
    entity_type: StaffNoteEntityType;
    entity_id: string;
  } | null;
  const { error } = await client
    .from("staff_notes")
    .delete()
    .eq("id", noteId);
  if (error) {
    throw new AppError("INTERNAL_ERROR", "Could not delete the note.", 500);
  }
  if (!row) {
    throw new AppError("NOT_FOUND", "Note not found (it may have been deleted).", 404);
  }
  await auditFor(admin.id, "note_deleted", row.entity_type, row.entity_id, row.id);
}

/** Audit with the acting admin identified (who/what/when). */
async function auditFor(
  adminId: string,
  operation: string,
  entityType: string,
  entityId: string,
  noteId: string,
): Promise<void> {
  await logAdminAudit({
    actorUserId: adminId,
    operation,
    dataset: `staff_notes:${entityType}`.slice(0, 40),
    totalRows: 1,
    // admin_audit_log has no deleted_rows column; a delete is recorded
    // as one row updated (the operation name carries the intent).
    insertedRows: operation === "note_created" ? 1 : 0,
    updatedRows: operation === "note_created" ? 0 : 1,
    failedRows: 0,
    result: "success",
    summary: { note_id: noteId, entity_id: entityId, entity_type: entityType },
  });
}
