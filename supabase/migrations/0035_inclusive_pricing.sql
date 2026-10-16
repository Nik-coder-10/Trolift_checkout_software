-- 0035_inclusive_pricing.sql
-- ─── All-inclusive MRP pricing ──────────────────────────────────────
-- Effective pricing model change: the published catalogue price is now
-- the final payable amount — GST (18% ladders / 5% trolleys) and
-- delivery are BOTH absorbed into it.
--
--   • products.price        = inclusive MRP (what the customer pays)
--   • delivery on orders    = 0.00 on every serviceable pincode
--     (pincode_rates / slabs / category rules now only decide
--     serviceable-vs-not; they no longer add charges)
--   • order storage         = reverse-computed: line/order taxable
--     values keep the existing subtotal/taxable identities so DB
--     CHECKs and invoice builders stay intact; the GST columns hold
--     the embedded tax (inclusive price − taxable value).
--
-- Prices (dealer + revised), confirmed 16/10/2026.

update public.products p
set price = m.price::numeric(12,2),
    updated_at = now()
from (
  values
    ('talt-032', '5790.00'),
    ('talt-038', '6990.00'),
    ('talt-044', '8090.00'),
    ('talt-055', '9290.00'),
    ('talt-060', '10490.00'),
    ('talt-072', '12290.00'),
    ('talt-f44', '8590.00'),
    ('talt-f55', '9990.00'),
    ('talt-d44', '9390.00'),
    ('talt-d56', '12490.00'),
    ('talt-d66', '13990.00'),
    ('tmst-150', '2999.00'),
    ('tmst-300', '3859.00'),
    ('tmst-400', '4999.00'),
    ('tmst-600', '5990.00'),
    ('tpt-200', '3250.00'),
    ('tpt-400', '3990.00'),
    ('tpt-600', '5690.00')
) as m(slug, price)
where p.slug = m.slug;

do $$
declare
  bad int;
begin
  select count(*) into bad
  from public.products p
  join (values
    ('talt-032', '5790.00'),
    ('talt-038', '6990.00'),
    ('talt-044', '8090.00'),
    ('talt-055', '9290.00'),
    ('talt-060', '10490.00'),
    ('talt-072', '12290.00'),
    ('talt-f44', '8590.00'),
    ('talt-f55', '9990.00'),
    ('talt-d44', '9390.00'),
    ('talt-d56', '12490.00'),
    ('talt-d66', '13990.00'),
    ('tmst-150', '2999.00'),
    ('tmst-300', '3859.00'),
    ('tmst-400', '4999.00'),
    ('tmst-600', '5990.00'),
    ('tpt-200', '3250.00'),
    ('tpt-400', '3990.00'),
    ('tpt-600', '5690.00')
  ) as m(slug, price) on m.slug = p.slug
  where p.price::numeric(12,2) <> m.price::numeric(12,2);

  if bad <> 0 then
    raise exception 'inclusive pricing: % product prices do not match the approved list', bad;
  end if;
end $$;
