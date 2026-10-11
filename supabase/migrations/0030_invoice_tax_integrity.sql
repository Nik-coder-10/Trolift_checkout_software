-- Trolift Solutions — 0030 invoice + tax integrity hardening
--
-- Prompt 49 audit findings (verified against 0017/0028 SQL):
--   1. 0017 grants `usage, select on sequence invoice_number_seq` to
--      `authenticated`, and `revoke ... from public` does not remove
--      Supabase's default EXECUTE grants (proved in 0028 for functions).
--      Any logged-in user can therefore burn invoice numbers — directly
--      via nextval() or through generate_invoice_number() — creating
--      gaps (and a numbering-DoS vector) outside the service-role
--      issuance path. Lock both the sequence and the generator to the
--      service role.
--   2. The CGST+SGST vs IGST mutual exclusivity and the non-GST
--      zero-tax invariant live only in application code
--      (lib/invoices/data.ts). A direct write or a future code path
--      could persist a mixed-split or a taxed "non_gst" order that the
--      invoice builder would then refuse (500 at download time).
--      Enforce the same invariant at the database layer. Legacy rows
--      (pre-0016, all zeros) satisfy it, so validation is safe.
-- Forward migration only; earlier files untouched.

-- ─── 1. Invoice numbering: service role only ─────────────────────────
revoke execute on function public.generate_invoice_number(text) from authenticated;
revoke execute on function public.invoice_financial_year(date) from authenticated;
revoke all on sequence public.invoice_number_seq from authenticated;
revoke all on sequence public.invoice_number_seq from anon;
grant usage, select on sequence public.invoice_number_seq to service_role;

-- ─── 2. Order tax-split integrity ────────────────────────────────────
-- Intra-state (CGST+SGST) and inter-state (IGST) are mutually exclusive
-- by construction, and non-GST orders carry no tax at all.
alter table public.orders
  drop constraint if exists orders_tax_split_check;
alter table public.orders
  add constraint orders_tax_split_check check (
    (cgst_amount + sgst_amount = 0 or igst_amount = 0)
    and (
      tax_treatment <> 'non_gst'
      or (cgst_amount = 0 and sgst_amount = 0 and igst_amount = 0)
    )
  );
