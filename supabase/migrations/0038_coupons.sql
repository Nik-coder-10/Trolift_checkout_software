-- Redeem codes (coupons): one active offer at a time, applied to the
-- order total.
--
-- FIRST300  - Rs 300 off for first-time buyers (no prior order on the
--             mobile number).
-- NAVRATRI400 - Rs 400 off, expires at the end of Navratri 2026
--             (Oct 20; Dussehra falls on Oct 20).
--
-- The storefront never reads this table directly (no anon grant): the
-- public /api/coupons/validate route and the order path both resolve
-- codes server-side with the service role, and admins manage rows via
-- /admin/coupons. orders.coupon_code / orders.discount_amount snapshot
-- what was actually granted.
--
-- create_order(): carry coupon_code + discount_amount (0037 body +
-- columns), and orders_total_check now subtracts the discount.

begin;

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null
    check (code = upper(code) and code ~ '^[A-Z0-9]{3,32}$'),
  discount_paise bigint not null check (discount_paise > 0),
  first_order_only boolean not null default false,
  active boolean not null default true,
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_valid_window check (
    valid_from is null or valid_until is null or valid_until > valid_from
  )
);

create index coupons_code_idx on public.coupons (code);

create trigger coupons_set_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();

-- Admin-only table: the storefront role gets neither grant nor policy
-- (same shape as staff_notes), so codes can never be enumerated.
alter table public.coupons enable row level security;
grant all on public.coupons to authenticated;
revoke all on public.coupons from anon;

create policy coupons_admin_all
  on public.coupons
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

comment on table public.coupons is
  'Redeem codes: fixed rupees off the order total, optional first-order and validity-window rules.';

insert into public.coupons (code, discount_paise, first_order_only, valid_until)
values
  ('FIRST300', 30000, true, null),
  ('NAVRATRI400', 40000, false, '2026-10-21 00:00:00+05:30');

alter table public.orders
  add column if not exists coupon_code text
    check (coupon_code is null or (coupon_code = upper(coupon_code) and coupon_code ~ '^[A-Z0-9]{3,32}$')),
  add column if not exists discount_amount numeric(12, 2) not null default 0
    check (discount_amount >= 0);

comment on column public.orders.coupon_code is
  'Redeem code granted at checkout (null when no offer was applied).';
comment on column public.orders.discount_amount is
  'Rupees deducted from the order total by coupon_code (0 when none).';

-- The customer pays total = subtotal + delivery + tax - discount.
alter table public.orders
  drop constraint if exists orders_total_check;
alter table public.orders
  add constraint orders_total_check check (
    total_amount = subtotal + delivery_charge + cgst_amount + sgst_amount + igst_amount - discount_amount
  );

-- ─── create_order(): carry the coupon snapshot (0037 body + columns) ─
create or replace function public.create_order(
  p_idempotency_key text,
  p_customer jsonb,
  p_order jsonb,
  p_items jsonb,
  p_payment jsonb,
  p_reservation_hours integer default 48
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_pid uuid;
  v_product record;
  v_available integer;
  v_expires_at timestamptz;
begin
  if p_idempotency_key is null or p_idempotency_key = '' then
    raise exception 'idempotency key is required' using errcode = 'raise_exception';
  end if;

  select id into v_existing from public.orders
  where idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  if p_reservation_hours is null or p_reservation_hours < 1 then
    raise exception 'reservation window is required' using errcode = 'raise_exception';
  end if;
  v_expires_at := now() + (p_reservation_hours || ' hours')::interval;

  with swept as (
    delete from public.stock_reservations
    where status = 'held'
      and expires_at <= now()
    returning product_id, order_id, quantity
  )
  insert into public.inventory_events
    (product_id, order_id, event, quantity, balance_after, note)
  select s.product_id, s.order_id, 'released', 0, p.stock_quantity,
    'hold expired'
  from swept s
  join public.products p on p.id = s.product_id;

  for v_pid in
    select distinct (elem ->> 'product_id')::uuid
    from jsonb_array_elements(p_items) as elem
    order by 1
  loop
    perform 1 from public.products where id = v_pid for update;
  end loop;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select p.* into v_product from public.products p
    where p.id = (v_item ->> 'product_id')::uuid;
    if v_product.id is null then
      raise exception 'unknown product' using errcode = 'raise_exception';
    end if;
    select greatest(v_product.stock_quantity - coalesce(sum(r.quantity), 0), 0)
      into v_available
    from public.stock_reservations r
    where r.product_id = v_product.id
      and r.status = 'held'
      and r.expires_at > now();
    if v_available is null then
      v_available := v_product.stock_quantity;
    end if;
    if (v_item ->> 'quantity')::integer > v_available then
      raise exception 'INSUFFICIENT_STOCK: only % available of "%"',
        v_available, v_product.name
        using errcode = 'raise_exception';
    end if;
  end loop;

  insert into public.customers (name, phone, email, gstin, shipping_address)
  values (
    p_customer ->> 'name',
    p_customer ->> 'phone',
    nullif(p_customer ->> 'email', ''),
    nullif(p_customer ->> 'gstin', ''),
    nullif(p_customer ->> 'shipping_address', '')
  )
  on conflict (phone) do update set
    name = excluded.name,
    email = coalesce(excluded.email, public.customers.email),
    gstin = coalesce(excluded.gstin, public.customers.gstin),
    shipping_address = coalesce(excluded.shipping_address, public.customers.shipping_address),
    updated_at = now()
  returning id into v_customer_id;

  insert into public.orders (
    order_number, customer_id, subtotal, delivery_charge, total_amount,
    delivery_pincode, delivery_partner_id, delivery_partner_name,
    gstin_snapshot, payment_status, order_status, idempotency_key,
    tax_treatment, billing_name, billing_address_line, billing_city,
    billing_state, billing_state_code, billing_pincode,
    taxable_amount, cgst_amount, sgst_amount, igst_amount,
    customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
    stock_state, delivery_weight_kg, delivery_rule_summary,
    shipping_address, coupon_code, discount_amount
  )
  values (
    coalesce(nullif(p_order ->> 'order_number', ''), public.generate_order_number()),
    v_customer_id,
    (p_order ->> 'subtotal')::numeric,
    (p_order ->> 'delivery_charge')::numeric,
    (p_order ->> 'total_amount')::numeric,
    p_order ->> 'delivery_pincode',
    nullif(p_order ->> 'delivery_partner_id', '')::uuid,
    p_order ->> 'delivery_partner_name',
    nullif(p_order ->> 'gstin_snapshot', ''),
    coalesce(p_order ->> 'payment_status', 'pending'),
    coalesce(p_order ->> 'order_status', 'pending_payment'),
    p_idempotency_key,
    coalesce(p_order ->> 'tax_treatment', 'non_gst'),
    nullif(p_order ->> 'billing_name', ''),
    nullif(p_order ->> 'billing_address_line', ''),
    nullif(p_order ->> 'billing_city', ''),
    nullif(p_order ->> 'billing_state', ''),
    nullif(p_order ->> 'billing_state_code', ''),
    nullif(p_order ->> 'billing_pincode', ''),
    coalesce((p_order ->> 'taxable_amount'), '0')::numeric,
    coalesce((p_order ->> 'cgst_amount'), '0')::numeric,
    coalesce((p_order ->> 'sgst_amount'), '0')::numeric,
    coalesce((p_order ->> 'igst_amount'), '0')::numeric,
    p_customer ->> 'name',
    p_customer ->> 'phone',
    nullif(p_customer ->> 'email', ''),
    'reserved',
    nullif(p_order ->> 'delivery_weight_kg', '')::numeric,
    nullif(p_order ->> 'delivery_rule_summary', ''),
    nullif(p_order ->> 'shipping_address', ''),
    nullif(p_order ->> 'coupon_code', ''),
    coalesce((p_order ->> 'discount_amount'), '0')::numeric
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.order_items (
      order_id, product_id, product_name, quantity, unit_price, line_total,
      gst_rate_percent, line_tax_amount, hsn_snapshot
    )
    values (
      v_order_id,
      (v_item ->> 'product_id')::uuid,
      v_item ->> 'product_name',
      (v_item ->> 'quantity')::integer,
      (v_item ->> 'unit_price')::numeric,
      (v_item ->> 'line_total')::numeric,
      nullif(v_item ->> 'gst_rate_percent', '')::numeric,
      coalesce((v_item ->> 'line_tax_amount'), '0')::numeric,
      nullif(v_item ->> 'hsn_snapshot', '')
    );
    insert into public.stock_reservations
      (product_id, order_id, quantity, expires_at)
    values (
      (v_item ->> 'product_id')::uuid,
      v_order_id,
      (v_item ->> 'quantity')::integer,
      v_expires_at
    );
    insert into public.inventory_events
      (product_id, order_id, event, quantity, balance_after, note)
    values (
      (v_item ->> 'product_id')::uuid,
      v_order_id,
      'reserved',
      0,
      (select stock_quantity from public.products
       where id = (v_item ->> 'product_id')::uuid),
      'hold expires ' || v_expires_at::text
    );
  end loop;

  insert into public.payments (order_id, amount, method, status, transaction_reference, metadata)
  values (
    v_order_id,
    (p_payment ->> 'amount')::numeric,
    coalesce(p_payment ->> 'method', 'upi'),
    'pending',
    nullif(p_payment ->> 'transaction_reference', ''),
    coalesce(p_payment -> 'metadata', '{}'::jsonb)
  );

  insert into public.order_events (
    order_id, event_type, actor_type, actor_user_id, action,
    from_status, to_status, metadata
  )
  values (
    v_order_id, 'ORDER_CREATED', 'customer', v_customer_id,
    'order_created', null,
    coalesce(p_order ->> 'order_status', 'pending_payment'),
    jsonb_build_object(
      'payment_method', coalesce(p_payment ->> 'method', 'upi'),
      'item_count', jsonb_array_length(p_items),
      'total_paise',
        round(((p_order ->> 'total_amount')::numeric * 100))::integer
    )
  );

  return v_order_id;
end;
$$;

revoke all on function public.create_order(text, jsonb, jsonb, jsonb, jsonb, integer) from public;
grant execute on function public.create_order(text, jsonb, jsonb, jsonb, jsonb, integer) to service_role;

commit;
