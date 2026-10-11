-- Trolift Solutions — 0028 revoke anonymous RPC execution
--
-- Staging verification (Prompt 43) proved on live PostgreSQL that the
-- `revoke all ... from public` clauses in earlier migrations do NOT
-- remove Supabase's default EXECUTE grants to the anon role: live ACLs
-- show `anon=X` on every public function. Combined with the
-- `is_admin() or auth.uid() is null` guards (null is true for BOTH
-- anon and service_role), anonymous callers could:
--   * create orders via create_order() (both overloads),
--   * consume/restore ANY order's stock reservations,
--   * insert/update products and delivery rates via import_*,
--   * burn invoice numbers via generate_invoice_number().
-- All demonstrated against the local staging stack before this fix.
--
-- Fix: explicit `revoke execute ... from anon` on every function the
-- storefront never needs. `authenticated` grants are KEPT wherever the
-- app itself calls through the RLS client (consume/restore/import in
-- admin flows) or where self-guards already deny non-admins
-- (get_admin_*). anon keeps is_admin(), product_availability() and
-- search_products(), which the storefront legitimately uses (policies
-- and public catalogue evaluate them for anonymous sessions).
-- Forward migration only; earlier files untouched.

-- Server-only order creation (app uses the service-role client).
revoke execute on function public.create_order(text, jsonb, jsonb, jsonb, jsonb) from anon;
revoke execute on function public.create_order(text, jsonb, jsonb, jsonb, jsonb, integer) from anon;

-- Reservation lifecycle (app: authenticated admins + service role).
revoke execute on function public.consume_reservation(uuid) from anon;
revoke execute on function public.restore_reservation(uuid, text) from anon;

-- Invoice numbering (app: service role only).
revoke execute on function public.generate_invoice_number(text) from anon;
revoke execute on function public.invoice_financial_year(date) from anon;

-- Bulk imports (app: authenticated admins via RLS client).
revoke execute on function public.import_products(jsonb) from anon;
revoke execute on function public.import_rates(jsonb) from anon;

-- Admin aggregates (strict is_admin() guards already deny anon, but
-- least privilege should not rely on a single layer).
revoke execute on function public.get_admin_dashboard(integer) from anon;
revoke execute on function public.get_admin_command_center(text, integer, integer) from anon;
revoke execute on function public.get_admin_customers(text, text, integer, integer) from anon;
revoke execute on function public.get_admin_customer(uuid) from anon;
revoke execute on function public.admin_search_pattern(text) from anon;
