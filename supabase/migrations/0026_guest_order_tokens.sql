-- Trolift Solutions — 0026 guest order tokens
--
-- Secure guest order access via capability tokens (hashes only).
-- History note (staging verification, Prompt 43): this table was first
-- drafted as `0024_order_access_tokens.sql`, which collided with
-- `0024_admin_command_center.sql` — Supabase versions migrations by
-- leading digits, so a fresh database halted with
-- `duplicate key ... schema_migrations_pkey (0024)` and the table was
-- NEVER created anywhere. The duplicate file was removed (it had never
-- applied) and its content folded here idempotently.
--   * token_hash uniqueness (direct hash lookup, no scan),
--   * label (checkout / recovery / rotation provenance, bounded),
--   * last_used_at usage stamp.
-- The one-active-token-per-order partial unique index from 0024 is
-- preserved: issuance always revokes prior tokens first, so rotation
-- and recovery converge on exactly one active token.

create table if not exists public.order_access_tokens (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null
    references public.orders (id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  revoked_at timestamptz,
  last_used_at timestamptz,
  label text not null default 'checkout' check (char_length(label) <= 40)
);

alter table public.order_access_tokens
  add column if not exists token_hash text;
alter table public.order_access_tokens
  add column if not exists created_at timestamptz not null default now();
alter table public.order_access_tokens
  add column if not exists expires_at timestamptz not null default (now() + interval '90 days');
alter table public.order_access_tokens
  add column if not exists revoked_at timestamptz;
alter table public.order_access_tokens
  add column if not exists last_used_at timestamptz;
alter table public.order_access_tokens
  add column if not exists label text not null default 'checkout';

-- Direct hash lookup must be unique: a presented token maps to at most
-- one row, so verification is exact instead of scan-and-compare.
create unique index if not exists order_access_tokens_hash_unique
  on public.order_access_tokens (token_hash);

-- One active token per order (reaffirmed idempotently).
create unique index if not exists order_access_tokens_one_active
  on public.order_access_tokens (order_id)
  where revoked_at is null;

create index if not exists order_access_tokens_order_idx
  on public.order_access_tokens (order_id)
  where revoked_at is null;

create index if not exists order_access_tokens_expires_idx
  on public.order_access_tokens (expires_at);

alter table public.order_access_tokens enable row level security;
-- No policies: guests have no session, admins use the service role
-- server-side. Authenticated non-admin roles get nothing.
