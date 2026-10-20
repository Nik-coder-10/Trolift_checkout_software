-- 0041 — net redeem discounts into quotations frozen before the fix.
--
-- A quotation frozen before this change always computed
--     grandTotal = subtotal + tax
-- while the order, the invoice and the pay page charge
--     total = subtotal + delivery + tax - discount_amount
-- (orders_total_check). Every frozen quotation whose order carries a
-- redeem discount therefore OVERSTATES the payable amount — the
-- customer sees a discounted total on the pay page but a full-price
-- quotation PDF.
--
-- This file corrects those frozen documents in place, exactly once:
--     data.totals.discountPaise  = discount_amount x 100
--     data.totals.couponCode     = coupon_code (null when empty)
--     data.totals.grandTotalPaise = grandTotal - discountPaise
-- The row shape matches what lib/quotations/data.ts now builds for
-- every NEW quotation (0-for-discount rows and legacy frozen docs
-- without the keys keep rendering as before).
--
-- Read-only pre-check (run against the target database first; this
-- file only touches the rows it returns):
--   select q.quotation_number, o.order_number, o.discount_amount,
--          o.coupon_code,
--          q.data -> 'totals' ->> 'grandTotalPaise' as grand_total,
--          q.data -> 'totals' ->> 'discountPaise'    as quoted_discount
--   from public.quotations q
--   join public.orders o on o.id = q.order_id
--   where o.discount_amount > 0
--     and q.data is not null
--     and q.data -> 'totals' ->> 'discountPaise' is null;
--
-- quotations_freeze_data forbids changing frozen JSON by design, so
-- this one corrective pass drops the trigger, patches ONLY the rows
-- above, and restores the identical trigger in the same transaction
-- (migrations are transactional per file). The WHERE clause keeps the
-- update idempotent: a second run finds discountPaise already set and
-- touches nothing, so the discount can never be subtracted twice.

drop trigger if exists quotations_freeze_data on public.quotations;

update public.quotations q
set data = jsonb_set(
      jsonb_set(
        jsonb_set(
          q.data,
          '{totals,discountPaise}',
          to_jsonb(round((o.discount_amount * 100))::bigint)
        ),
        '{totals,couponCode}',
        to_jsonb(nullif(o.coupon_code, ''))
      ),
      '{totals,grandTotalPaise}',
      to_jsonb(
        round(
          (q.data #>> '{totals,grandTotalPaise}')::numeric
          - (o.discount_amount * 100)
        )::bigint
      )
    )
from public.orders o
where o.id = q.order_id
  and o.discount_amount > 0
  and q.data is not null
  and q.data -> 'totals' ->> 'discountPaise' is null;

create trigger quotations_freeze_data
  before update on public.quotations
  for each row execute function public.freeze_quotation_data();
