-- Trolift Solutions — 0039 site settings (store configuration overrides)
--
-- Key-value overrides for configuration operators need to change
-- without a redeploy: UPI payee, payment window, invoice prefix,
-- quotation validity, business contact, default low-stock threshold.
-- A MISSING key always falls back to the deployment's environment
-- value — env stays the default, this table only carries overrides
-- (empty form fields delete the override row).
--
-- Admin-only: no anon grant, is_admin() policy (same shape as 0038
-- coupons), so no public surface ever reads or writes settings.

begin;

create table public.site_settings (
  key text primary key
    check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  value text not null check (length(value) between 1 and 500),
  updated_at timestamptz not null default now()
);

create trigger site_settings_set_updated_at
  before update on public.site_settings
  for each row execute function public.set_updated_at();

alter table public.site_settings enable row level security;
grant all on public.site_settings to authenticated;
revoke all on public.site_settings from anon;

create policy site_settings_admin_all
  on public.site_settings
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.site_settings is
  'Store configuration overrides (UPI, payment window, invoice prefix, quotation validity, contact, default low-stock threshold); missing keys fall back to environment defaults.';

commit;
