-- Trolift Solutions — 0029 widen order-status CHECK for milestones
--
-- Staging verification (Prompt 44) proved on live PostgreSQL that the
-- fulfilment milestones PACKED and READY_FOR_DISPATCH (introduced with
-- the inventory lifecycle in 0018, driven through the admin UI and the
-- fulfillment API) can never persist: orders_order_status_check still
-- lists only the 0012-era values, so the update rejects with a CHECK
-- violation — surfaced to operators as a misleading "Order changed
-- state. Reload and retry." 409 (guardedUpdate swallows the error).
-- Forward migration only; 0012 itself is untouched.

alter table public.orders
  drop constraint if exists orders_order_status_check;
alter table public.orders
  add constraint orders_order_status_check check (order_status in (
    'draft', 'pending_payment', 'payment_submitted', 'paid', 'confirmed',
    'processing', 'packed', 'ready_for_dispatch',
    'shipped', 'dispatched', 'delivered', 'cancelled'
  ));
