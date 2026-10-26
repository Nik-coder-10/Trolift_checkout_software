-- Trolift Solutions — 0041 manual quotations (quotation maker)
--
-- The existing quotations table (0031) is one frozen document per
-- ORDER: its order_id is NOT NULL + UNIQUE and every field is derived
-- from order snapshots. A quotation maker needs the opposite shape —
-- staff-typed parties, prices and delivery, with no order behind them —
-- so it gets its own additive table instead of loosening 0031 (which
-- would weaken the per-order uniqueness guarantee that the existing
-- issuance flow relies on).
--
--   * manual_quotations stores one frozen document per quotation made
--     in the admin quotation maker: a server-generated, never-reused
--     number (the SAME QTN-TS sequence as order quotations, so numbers
--     stay unique across both sources), the party the quote was made
--     for, and the canonical frozen QuotationData JSON.
--   * party_type records who the offer was for (dealer / distributor /
--     customer). It is bookkeeping for the admin list only — the PDF
--     format is identical for all three.
--   * The document is immutable once written, mirroring 0031: no
--     update path is exposed and the trigger below refuses any change
--     to the frozen data or the quotation identity.
--   * RLS: admins only (same policy shape as quotations/invoices);
--     reads and writes in app code use the service role server-side.
--
-- Forward migration only; earlier files untouched.

create table if not exists public.manual_quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_number text not null unique check (
    quotation_number ~ '^QTN-TS[0-9]{10}$'
  ),
  quotation_date date not null default CURRENT_DATE,
  valid_till date not null,
  -- Who the offer was prepared for (list/filter only; not on the PDF).
  party_type text not null check (
    party_type in ('dealer', 'distributor', 'customer')
  ),
  party_name text not null check (char_length(party_name) between 1 and 200),
  party_phone text,
  party_gstin text,
  -- Grand total in paise, denormalised for the admin list (the canonical
  -- figure is totals.grandTotalPaise inside data).
  total_paise bigint not null check (total_paise >= 0),
  data jsonb not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists manual_quotations_date_idx
  on public.manual_quotations (created_at desc);
create index if not exists manual_quotations_party_idx
  on public.manual_quotations (party_name);

create trigger manual_quotations_set_updated_at
  before update on public.manual_quotations
  for each row execute function public.set_updated_at();

-- Frozen means frozen: a written quotation never changes. Reprints read
-- the stored document, so a later price/config edit cannot alter what
-- the customer already received.
create or replace function public.freeze_manual_quotation()
returns trigger
language plpgsql
as $$
begin
  if new.data is distinct from old.data
    or new.quotation_number is distinct from old.quotation_number
    or new.quotation_date is distinct from old.quotation_date
    or new.valid_till is distinct from old.valid_till then
    raise exception 'manual quotation is frozen' using errcode = 'raise_exception';
  end if;
  return new;
end;
$$;

drop trigger if exists manual_quotations_freeze on public.manual_quotations;
create trigger manual_quotations_freeze
  before update on public.manual_quotations
  for each row execute function public.freeze_manual_quotation();

-- ─── Access: service role + admins only (mirror quotations) ─────────
alter table public.manual_quotations enable row level security;

grant all on public.manual_quotations to authenticated;
grant all on public.manual_quotations to service_role;

create policy manual_quotations_admin_all
  on public.manual_quotations for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Numbering reuses public.generate_quotation_number() from 0031, whose
-- EXECUTE grant is already service_role only.
