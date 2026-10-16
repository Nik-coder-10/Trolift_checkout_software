-- Trolift Solutions — 0033 backfill product GST rates
--
-- The always-GST model (tax applies to every order, not just GSTIN
-- holders) needs a rate on every product; the deterministic seed and
-- early rows shipped with gst_rate NULL, which the engine treats as
-- 0%. Rates are per-category, NOT blanket 18%:
--
--   * Platform trolleys (category "Trolleys", name "platform trolley")
--     → 5.00% (owner-confirmed rate for these goods).
--   * Telescopic / any ladders → 18.00% (owner-confirmed).
--   * Everything else (machinery, lifting, dock, drum handling,
--     material movement) → 18.00% standard goods rate.
--
-- Only NULL rates are touched — products with an explicit rate
-- (imports, admin edits) are preserved. The engine and admin UI
-- continue to respect any future per-product override.
--
-- Forward-only data migration: no schema change, no constraint, no
-- function rewrite. Idempotent: re-running changes nothing.

update public.products
   set gst_rate = case
     when category = 'Trolleys' or name ilike '%platform trolley%' then 5.00
     else 18.00
   end
 where gst_rate is null;
