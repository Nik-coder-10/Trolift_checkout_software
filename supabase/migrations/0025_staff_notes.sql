-- Trolift Solutions — 0025 internal staff notes
--
-- STRICTLY ADMIN/STAFF ONLY. Notes attach to orders, customers and
-- products via an explicit entity_type CHECK — never a client-supplied
-- table name. Rows are plain text (React-escaped at display; no HTML
-- is stored or rendered). Body is capped at 1000 chars at the database
-- layer, not just the UI.
--
-- Access: RLS policies grant all operations to authenticated admins
-- only (public.is_admin()). The anon role has no policies and no
-- grants, so guest sessions cannot read or write a single row even if
-- application code were bypassed. Notes are excluded from customer
-- exports and invoices by construction: nothing outside lib/admin/*
-- reads this table.

create table if not exists public.staff_notes (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null
    check (entity_type in ('order', 'customer', 'product')),
  entity_id uuid not null,
  author_user_id uuid not null,
  body text not null
    check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_notes_entity_idx
  on public.staff_notes (entity_type, entity_id, created_at desc);
create index if not exists staff_notes_author_idx
  on public.staff_notes (author_user_id);

alter table public.staff_notes enable row level security;

-- Admin-only: authenticated DML (further gated by the is_admin()
-- policy), and an explicit anon revocation so the storefront role has
-- neither a grant nor a policy on this table.
grant all on public.staff_notes to authenticated;
revoke all on public.staff_notes from anon;

create policy staff_notes_admin_all
  on public.staff_notes
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- updated_at maintenance (same pattern as other tables)
create trigger staff_notes_set_updated_at
  before update on public.staff_notes
  for each row execute function public.set_updated_at();
