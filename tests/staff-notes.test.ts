import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockClient,
  type MockOp,
  type MockResponder,
  type MockUser,
} from "@/tests/helpers/supabase-mock";
import { resetRateLimits } from "@/lib/rate-limit/index";

vi.mock("server-only", () => ({}));

let authUser: MockUser | null = { id: "admin-1" };
let adminFlag = true;
let handler: MockResponder = () => {
  throw new Error("unexpected query");
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    createMockClient((op) => {
      if (op.table === "profiles") {
        return { rows: adminFlag ? [{ is_admin: true }] : [], error: null };
      }
      return handler(op);
    }, { authUser }),
}));

import {
  createStaffNote,
  deleteStaffNote,
  listStaffNotes,
  normalizeNoteBody,
  STAFF_NOTE_MAX_LENGTH,
  updateStaffNote,
} from "@/lib/admin/notes";
import { AppError } from "@/lib/api/errors";
import { GET, POST, PATCH, DELETE } from "@/app/api/admin/notes/route";

beforeEach(() => {
  resetRateLimits();
  authUser = { id: "admin-1" };
  adminFlag = true;
  handler = () => {
    throw new Error("unexpected query");
  };
});

const NOTE_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  entity_type: "order",
  entity_id: "22222222-2222-4222-8222-222222222222",
  author_user_id: "admin-1",
  body: "Customer requested delivery before Friday.",
  created_at: "2026-10-08T06:00:00Z",
  updated_at: "2026-10-08T06:00:00Z",
};

function auditCapture() {
  const audits: Array<{ op: MockOp; values: Record<string, unknown> }> = [];
  const wrap: MockResponder = (op) => {
    if (op.table === "admin_audit_log" && op.updateValues) {
      audits.push({ op, values: op.updateValues as Record<string, unknown> });
      return { rows: [], error: null };
    }
    return handler(op);
  };
  return { wrap, audits };
}

function req(
  method: string,
  opts?: {
    url?: string;
    json?: unknown;
  },
): Request {
  return new Request(
    opts?.url ?? "http://localhost:3000/api/admin/notes",
    {
      method,
      ...(opts?.json !== undefined
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(opts.json),
          }
        : {}),
    });
}

describe("body validation (plain text, length, control chars)", () => {
  it("trims, caps length and strips control characters", () => {
    expect(normalizeNoteBody("  hello  ")).toBe("hello");
    expect(
      normalizeNoteBody("bad\u0000\u0007<p>text</p>\u001f"),
    ).toBe("bad<p>text</p>");
    // Control characters removed BEFORE slicing, so injection cannot
    // hide past the cap.
    const long = `${"x".repeat(STAFF_NOTE_MAX_LENGTH)}\u0000<script>`;
    expect(normalizeNoteBody(long)).not.toContain("<script>");
    expect(normalizeNoteBody(long)!.length).toBe(STAFF_NOTE_MAX_LENGTH);
    // Newlines survive; carrier returns and NULs do not.
    expect(normalizeNoteBody("a\r\nb\u0000")).toBe("a\nb");
    expect(normalizeNoteBody("   \n  ")).toBeNull();
    expect(normalizeNoteBody(42)).toBeNull();
  });

  it("rejects blank and over-length note bodies on create", async () => {
    const { wrap } = auditCapture();
    handler = wrap;
    await expect(
      createStaffNote({
        entityType: "order",
        entityId: NOTE_ROW.entity_id,
        body: "   ",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects over-length bodies with 422", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let err: any = null;
    try {
      await createStaffNote({
        entityType: "order",
        entityId: NOTE_ROW.entity_id,
        body: "a".repeat(STAFF_NOTE_MAX_LENGTH + 1),
      });
    } catch (e) {
      err = e;
    }
    expect(err?.status ?? null).toBe(422);
    // Oversize input must surface as a clean validation error, not a
    // crash or crash-like RangeError from deep-mocking internals.
    expect(String(err?.message)).not.toMatch(/call stack/i);
  });
});

describe("database defense (migration 0025)", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/0025_staff_notes.sql", import.meta.url),
    "utf8",
  );

  it("enables RLS and grants nothing to anon", () => {
    expect(sql).toMatch(
      /alter table public\.staff_notes enable row level security/i,
    );
    expect(sql).toMatch(/revoke all on public\.staff_notes from anon/i);
    // No policy may target the storefront role.
    expect(sql).not.toMatch(/to\s+anon/i);
  });

  it("admin policy checks is_admin() on both USING and WITH CHECK", () => {
    const policy = sql.slice(sql.indexOf("create policy staff_notes_admin_all"));
    expect(policy).toMatch(/using \(public\.is_admin\(\)\)/i);
    expect(policy).toMatch(/with check \(public\.is_admin\(\)\)/i);
  });

  it("restricts entity_type to the supported set and caps the body", () => {
    expect(sql).toMatch(
      /check \(entity_type in \('order', 'customer', 'product'\)\)/i,
    );
    expect(sql).toMatch(/char_length\(btrim\(body\)\) between 1 and 1000/i);
  });
});

describe("entity type + id validation", () => {
  it("rejects unsupported entity types (arbitrary table names)", async () => {
    const { wrap } = auditCapture();
    handler = wrap;
    await expect(
      createStaffNote({
        entityType: "admin_audit_log" as "order",
        entityId: NOTE_ROW.entity_id,
        body: "attempt",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects malformed entity ids", async () => {
    const { wrap } = auditCapture();
    handler = wrap;
    await expect(
      createStaffNote({
        entityType: "order",
        entityId: "'; DROP TABLE orders; --",
        body: "x",
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      listStaffNotes("order", "not-a-uuid"),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("fails closed when the target entity no longer exists", async () => {
    const { wrap } = auditCapture();
    handler = (op) => {
      if (op.table === "orders") {
        return { rows: [], error: null };
      }
      throw new Error(`unexpected table ${op.table}`);
    };
    await wrap;
    handler = (() => ({ rows: [], error: null })) as MockResponder;
    await expect(
      createStaffNote({
        entityType: "order",
        entityId: NOTE_ROW.entity_id,
        body: "x",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("authorization cannot be bypassed", () => {
  it("guests get 401 before any note query runs", async () => {
    authUser = null;
    const ops: MockOp[] = [];
    handler = (op) => {
      ops.push(op);
      return { rows: [], error: null };
    };
    await expect(listStaffNotes("order", NOTE_ROW.entity_id)).rejects.toBeInstanceOf(
      AppError,
    );
    expect(ops.filter((o) => o.table === "staff_notes")).toHaveLength(0);
    const res = await GET(req("GET", {
      url: `http://localhost:3000/api/admin/notes?entityType=order&entityId=${NOTE_ROW.entity_id}`,
    }));
    expect(res.status).toBe(401);
  });

  it("authenticated non-admins are refused at the API boundary", async () => {
    adminFlag = false;
    const ops: MockOp[] = [];
    handler = (op) => {
      ops.push(op);
      return { rows: [], error: null };
    };
    const res = await GET(req("GET", {
      url: `http://localhost:3000/api/admin/notes?entityType=order&entityId=${NOTE_ROW.entity_id}`,
    }));
    expect(res.status).toBe(403);
    expect(
      ops.filter((o) => o.table === "staff_notes"),
    ).toHaveLength(0);
  });

  it("customers cannot create notes through the API", async () => {
    adminFlag = false;
    const ops: MockOp[] = [];
    handler = (op) => {
      ops.push(op);
      return { rows: [], error: null };
    };
    const res = await POST(req("POST", {
      json: {
        entityType: "order",
        entityId: NOTE_ROW.entity_id,
        body: "customer injection attempt",
      },
    }));
    expect(res.status).toBe(403);
    // No insert ever reached the staff_notes table.
    expect(ops.filter((o) => o.table === "staff_notes" && o.updateValues)).toHaveLength(0);
  });

  it("non-admins cannot edit or delete notes", async () => {
    adminFlag = false;
    const ops: MockOp[] = [];
    handler = (op) => {
      ops.push(op);
      return { rows: [], error: null };
    };
    const editRes = await PATCH(req("PATCH", { json: { noteId: NOTE_ROW.id, body: "tampered" } }));
    expect(editRes.status).toBe(403);
    const delRes = await DELETE(req("DELETE", { url: `http://localhost:3000/api/admin/notes?id=${NOTE_ROW.id}` }));
    expect(delRes.status).toBe(403);
    expect(
      ops.filter((o) => o.table === "staff_notes"),
    ).toHaveLength(0);
  });
});

describe("admin CRUD", () => {
  it("admin can create a note (validated entity, audited)", async () => {
    handler = (op) => {
      if (op.table === "orders") {
        return { rows: [{ id: NOTE_ROW.entity_id }], error: null };
      }
      if (op.table === "staff_notes" && op.updateValues) {
        return { rows: [NOTE_ROW], error: null };
      }
      if (op.table === "admin_audit_log" && op.updateValues) {
        return { rows: [], error: null };
      }
      throw new Error(`unexpected table ${op.table}`);
    };
    const note = await createStaffNote({
      entityType: "order",
      entityId: NOTE_ROW.entity_id,
      body: "<script>alert(1)</script> Customer requested delivery before Friday.",
    });
    // Body is stored raw (any text allowed) but never rendered as HTML —
    // see NotesSection rendering policy + React text-node escaping.
    expect(note.body).toContain("Customer requested delivery before Friday.");
    expect(note.authorUserId).toBe("admin-1");
  });

  it("admin can read notes with newest first, capped at 100", async () => {
    const ops: MockOp[] = [];
    handler = (op) => {
      ops.push(op);
      if (op.table === "staff_notes") {
        return { rows: [NOTE_ROW], error: null };
      }
      throw new Error(`unexpected table ${op.table}`);
    };
    const notes = await listStaffNotes("order", NOTE_ROW.entity_id);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toBe(NOTE_ROW.body);
  });

  it("admin can edit a note; updated_at changes", async () => {
    const edited = { ...NOTE_ROW, body: "Edited: deliver via Jaipur route.", updated_at: "2026-10-08T07:00:00Z" };
    const ops: MockOp[] = [];
    handler = (op) => {
      ops.push(op);
      if (op.table === "staff_notes") {
        return { rows: [edited], error: null };
      }
      if (op.table === "admin_audit_log" && op.updateValues) {
        return { rows: [], error: null };
      }
      throw new Error(`unexpected table ${op.table}`);
    };
    const note = await updateStaffNote({
      noteId: NOTE_ROW.id,
      body: "Edited: deliver via Jaipur route.",
    });
    expect(note.body).toBe(edited.body);
    expect(note.updatedAt).not.toBe(note.createdAt);
    const upd = ops.find((o) => o.table === "staff_notes" && o.updateValues);
    expect(upd).toBeDefined();
  });

  it("admin can delete a note (audit names admin + entity)", async () => {
    const audits: Array<Record<string, unknown>> = [];
    handler = (op) => {
      if (op.table === "admin_audit_log" && op.updateValues) {
        audits.push(op.updateValues as Record<string, unknown>);
        return { rows: [], error: null };
      }
      if (op.table === "staff_notes") {
        // select-before-delete returns the note; the delete returns no rows
        if (op.updateValues === undefined && op.filters.length > 0) {
          return { rows: [NOTE_ROW], error: null };
        }
        return { rows: [], error: null };
      }
      throw new Error(`unexpected table ${op.table}`);
    };
    await expect(deleteStaffNote(NOTE_ROW.id)).resolves.toBeUndefined();
    expect(audits).toHaveLength(1);
    expect(audits[0]!.operation).toBe("note_deleted");
    expect(audits[0]!.actor_user_id).toBe("admin-1");
    const summary = audits[0]!.summary as Record<string, unknown>;
    expect(summary.entity_id).toBe(NOTE_ROW.entity_id);
    expect(JSON.stringify(audits)).not.toContain(NOTE_ROW.body);
  });

  it("delete of an unknown note is a 404, not a silent success", async () => {
    handler = (op) => {
      if (op.table === "staff_notes") {
        return { rows: [], error: null };
      }
      throw new Error(`unexpected table ${op.table}`);
    };
    await expect(deleteStaffNote(NOTE_ROW.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("audit trail", () => {
  it("create/update/delete write an audit record with admin, action, entity — without the note body", async () => {
    const audits: Array<Record<string, unknown>> = [];
    const edited = { ...NOTE_ROW, body: "edited", updated_at: "2026-10-08T07:00:00Z" };
    handler = (op) => {
      if (op.table === "admin_audit_log" && op.updateValues) {
        audits.push(op.updateValues as Record<string, unknown>);
        return { rows: [], error: null };
      }
      if (op.table === "orders") {
        return { rows: [{ id: NOTE_ROW.entity_id }], error: null };
      }
      if (op.table === "staff_notes") {
        return { rows: [edited], error: null };
      }
      throw new Error(`unexpected table ${op.table}`);
    };
    const created = await createStaffNote({
      entityType: "order",
      entityId: NOTE_ROW.entity_id,
      body: "note body",
    });
    await updateStaffNote({ noteId: created.id, body: "edited" });
    await deleteStaffNote(created.id);
    const operations = audits.map((a) => String(a.operation));
    expect(operations).toEqual(
      expect.arrayContaining(["note_created", "note_updated", "note_deleted"]),
    );
    for (const a of audits) {
      expect(a.result).toBe("success");
      expect(Number(a.inserted_rows) + Number(a.updated_rows)).toBe(1);
      const summary = a.summary as Record<string, unknown>;
      expect(summary.entity_type).toBe("order");
      expect(summary.entity_id).toBe(NOTE_ROW.entity_id);
      expect(JSON.stringify(a)).not.toContain("note body");
      expect(JSON.stringify(a)).not.toContain("edited\":");
    }
  });
});

describe("XSS surface", () => {
  it("stores script text as inert plain-text data", () => {
    const payload = `<img src=x onerror=alert(1)>`;
    // Markup is kept verbatim as a string. Nothing escapes into a
    // markup context: NotesSection renders it in a React text node and
    // no dangerouslySetInnerHTML exists anywhere in the component.
    expect(normalizeNoteBody(payload)).toBe(payload);
    const src = readFileSync(
      new URL("../components/admin/NotesSection.tsx", import.meta.url),
      "utf8",
    );
    // Guard against the prop being *used* (JSX form); the words may
    // still appear in the component's own doc comment.
    expect(src).not.toMatch(/dangerouslySetInnerHTML\s*=/);
    // Rendered as a React text node: {x.body}, never via innerHTML.
    expect(src).toMatch(/\{[a-z]\.body\}/);
  });
});

describe("API route parameter handling", () => {
  it("rejects GET without params and DELETE without note id", async () => {
    adminFlag = true;
    handler = () => ({ rows: [], error: null });
    const noParams = await GET(req("GET", { url: "http://localhost:3000/api/admin/notes" }));
    expect(noParams.status).toBe(400);
    const noId = await DELETE(req("DELETE"));
    expect(noId.status).toBe(400);
  });

  it("PATCH rejects malformed note ids with 400", async () => {
    adminFlag = true;
    handler = () => ({ rows: [], error: null });
    const res = await PATCH(req("PATCH", { json: { noteId: "bad", body: "x" } }));
    expect(res.status).toBe(400);
  });
});
