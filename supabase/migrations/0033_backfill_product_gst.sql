-- Trolift Solutions — 0033 backfill product GST rates
--
-- The always-GST model (tax applies to every order, not just GSTIN
-- holders) needs a rate on every product; the deterministic seed and
-- any early rows shipped with gst_rate NULL, which the engine treats
-- as 0%. Backfill those rows to India's standard goods rate of 18%
-- so live orders carry GST immediately. Products that already carry
-- a rate (imports, admin edits) are left untouched.
--
-- Forward-only data migration: no schema change, no constraint, no
-- function rewrite. The engine and admin UI continue to respect any
-- future per-product override (e.g. 5% or 12% items).

update public.products
   set gst_rate = 18.00
 where gst_rate is null;
