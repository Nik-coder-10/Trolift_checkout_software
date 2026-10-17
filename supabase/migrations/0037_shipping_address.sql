-- Shipping address: where the order is actually delivered.
--
-- Checkout has always collected name/mobile/email and a delivery
-- pincode, but the street address only ever existed on the GST billing
-- side. Capture it for every order so fulfilment can dispatch without
-- phoning the customer back, and keep it on the customer master so the
-- next order starts from the same place.
--
-- Existing rows stay NULL (the API makes the field required for new
-- orders; the RPC accepts an absent key so older callers keep working).

begin;

alter table public.orders
  add column if not exists shipping_address text;

alter table public.orders
  drop constraint if exists orders_shipping_address_check;

alter table public.orders
  add constraint orders_shipping_address_check
  check (shipping_address is null or char_length(btrim(shipping_address)) between 1 and 500);

comment on column public.orders.shipping_address is
  'Delivery address as typed at checkout (house/flat, street, area, city). Required for new orders.';

alter table public.customers
  add column if not exists shipping_address text;

alter table public.customers
  drop constraint if exists customers_shipping_address_check;

alter table public.customers
  add constraint customers_shipping_address_check
  check (shipping_address is null or char_length(btrim(shipping_address)) between 1 and 500);

comment on column public.customers.shipping_address is
  'Latest delivery address supplied at checkout (upserted on every order).';

-- ─── create_order(): carry the shipping address (0031 body + column) ─
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
    shipping_address
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
    nullif(p_order ->> 'shipping_address', '')
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
