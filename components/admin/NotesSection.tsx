"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import type { ApiResponse } from "@/types/api";

/**
 * Internal staff notes UI (admin pages only). Plain-text display via
 * React text nodes — no dangerouslySetInnerHTML, so stored content can
 * never execute. Edits are inline; deletes require an explicit modal
 * confirmation. The server (lib/admin/notes.ts + RLS) is the
 * authorization boundary, not this component.
 */

export interface StaffNoteView {
  id: string;
  entityType: string;
  entityId: string;
  authorUserId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

const MAX_LEN = 1000;

const TIME_FMT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", TIME_FMT);
}

function authorLabel(id: string): string {
  return `Admin ${id.slice(0, 8)}`;
}

export function NotesSection({
  entityType,
  entityId,
  initialNotes,
}: {
  entityType: "order" | "customer" | "product";
  entityId: string;
  initialNotes: StaffNoteView[];
}) {
  const [notes, setNotes] = useState<StaffNoteView[]>(initialNotes);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<StaffNoteView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (
    action: () => Promise<Response>,
    onDone: (json: { data?: unknown }) => void,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.ok) {
        setError(json.error.message);
        return;
      }
      onDone(json as unknown as { data?: unknown });
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(
      () =>
        fetch("/api/admin/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityType, entityId, body: draft }),
        }),
      (json) => {
        const note = (json.data as { note?: StaffNoteView })?.note;
        if (note) setNotes((n) => [note, ...n]);
        setDraft("");
      },
    );

  const saveEdit = () =>
    run(
      () =>
        fetch("/api/admin/notes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ noteId: editingId, body: editDraft }),
        }),
      (json) => {
        const note = (json.data as { note?: StaffNoteView })?.note;
        if (note) {
          setNotes((n) => n.map((x) => (x.id === note.id ? note : x)));
        }
        setEditingId(null);
        setEditDraft("");
      },
    );

  const confirmDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    void run(
      () => fetch(`/api/admin/notes?id=${encodeURIComponent(target.id)}`, {
        method: "DELETE",
      }),
      () => setNotes((n) => n.filter((x) => x.id !== target.id)),
    );
  };

  return (
    <section
      aria-label="Internal staff notes"
      className="rounded-lg border border-zinc-200 bg-white p-5"
    >
      <h2 className="text-base font-bold text-zinc-900">Internal notes</h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        Staff-only. Never shown to customers, on invoices, or in exports.
        Plain text, max {MAX_LEN} characters.
      </p>

      {error ? (
        <div className="mt-3">
          <Alert tone="error" title="Action failed">
            {error}
          </Alert>
        </div>
      ) : null}

      <form
        className="mt-3 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label htmlFor={`note-body-${entityType}`} className="sr-only">
          Add an internal note
        </label>
        <textarea
          id={`note-body-${entityType}`}
          rows={3}
          maxLength={MAX_LEN}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add an internal note (e.g. “Customer requested delivery before Friday.”)"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-brand-700"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-zinc-400">
            {draft.length}/{MAX_LEN}
          </span>
          <Button
            type="submit"
            disabled={busy || draft.trim().length === 0}
            size="sm"
          >
            {busy ? "Saving…" : "Add note"}
          </Button>
        </div>
      </form>

      <div className="mt-4">
        {notes.length === 0 ? (
          <EmptyState
            title="No internal notes yet"
            message="Operational context added here stays staff-only."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((n) =>
              editingId === n.id ? (
                <li
                  key={n.id}
                  className="rounded-md border border-brand-300 bg-white p-3"
                >
                  <textarea
                    aria-label="Edit note"
                    rows={3}
                    maxLength={MAX_LEN}
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-brand-700"
                  />
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy || editDraft.trim().length === 0}
                      onClick={() => void saveEdit()}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(null);
                        setEditDraft("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </li>
              ) : (
                <li
                  key={n.id}
                  className="rounded-md border border-zinc-200 p-3 text-sm"
                >
                  {/* Plain text render — React escapes, never HTML. */}
                  <p className="whitespace-pre-wrap break-words text-zinc-900">
                    {n.body}
                  </p>
                  <p className="mt-1.5 text-xs text-zinc-500">
                    {authorLabel(n.authorUserId)} · {fmt(n.createdAt)}
                    {n.updatedAt !== n.createdAt
                      ? ` · edited ${fmt(n.updatedAt)}`
                      : ""}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(n.id);
                        setEditDraft(n.body);
                      }}
                      className="cursor-pointer text-xs font-bold text-brand-800 hover:text-brand-600 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(n)}
                      className="cursor-pointer text-xs font-bold text-red-700 hover:text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete this note?"
      >
        <p className="text-sm text-zinc-600">
          This permanently removes the note. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy} onClick={confirmDelete}>
            {busy ? "Deleting…" : "Delete note"}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
