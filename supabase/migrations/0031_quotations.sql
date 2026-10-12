-- Trolift Solutions — 0031 quotations/proforma + HSN snapshots
--
-- Customer quotations are provisional documents (never tax invoices):
--   * products gains hsn_code (HSN 4/6/8 digits, NULL = not configured;
--     printed per line when present, blank otherwise).
--   * order_items gains hsn_snapshot so a later catalogue edit cannot
--     rewrite a frozen quotation (same snapshot discipline as
--     gst_rate_percent in 0016).
--   * create_order() (6-arg live overload) is replaced to persist the
--     HSN snapshot; the legacy 5-arg overload keeps inserting NULL.
--   * quotations stores one frozen record per quoted order: a
--     server-generated, never-reused quotation number (QTN-TS + 10-digit
--     sequence, e.g. QTN-TS0000121264) plus the frozen quotation JSON
--     (see lib/quotations/data.ts). A trigger forbids altering frozen
--     data, mirroring invoices in 0017.
--   * Numbering is server-side (SECURITY DEFINER, service role only;
--     anon/authenticated explicitly revoked per the 0028/0030 lesson:
--     `revoke from public` alone does not remove Supabase's default
--     EXECUTE grants).
--   * order_events gains the QUOTATION_ISSUED type (additive CHECK
--     widening; old readers unaffected).
-- Forward migration only; earlier files untouched.

-- ─── HSN snapshots ───────────────────────────────────────────────────
alter table public.products
  add column if not exists hsn_code text
  constraint products_hsn_code_check check (
    hsn_code is null or hsn_code ~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$'
  );

alter table public.order_items
  add column if not exists hsn_snapshot text
  check (
    hsn_snapshot is null
    or hsn_snapshot ~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$'
  );

-- ─── Quotation numbering (sequence + server-side generator) ─────────
create sequence if not exists public.quotation_number_seq;

-- Quotation number: QTN-TS + zero-padded sequence (e.g. QTN-TS0000121264).
-- nextval() is atomic: concurrent callers get distinct numbers.
-- Rolled-back transactions leave gaps (never reassignments).
-- Deliberately no financial-year segment: quotations are provisional
-- working documents, not tax filings; numbers stay unique forever.
create or replace function public.generate_quotation_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return 'QTN-TS'
    || lpad(nextval('public.quotation_number_seq')::text, 10, '0');
end;
$$;

revoke all on function public.generate_quotation_number() from public;
revoke execute on function public.generate_quotation_number() from anon;
revoke execute on function public.generate_quotation_number() from authenticated;
grant execute on function public.generate_quotation_number() to service_role;

-- ─── Quotations (one frozen record per quoted order) ────────────────
create table if not exists public.quotations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique
    references public.orders (id) on delete cascade,
  quotation_number text not null unique check (
    quotation_number ~ '^QTN-TS[0-9]{10}$'
  ),
  quotation_date date not null default CURRENT_DATE,
  valid_till date not null,
  -- Frozen quotation JSON (canonical QuotationData). NULL only between
  -- number-claim and content-freeze within a single service request;
  -- the trigger below forbids any change once set.
  data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quotations_order_idx on public.quotations (order_id);
create index if not exists quotations_number_idx on public.quotations (quotation_number);

create trigger quotations_set_updated_at
  before update on public.quotations
  for each row execute function public.set_updated_at();

-- Frozen means frozen: once data is set, no UPDATE may change it.
create or replace function public.freeze_quotation_data()
returns trigger
language plpgsql
as $$
begin
  if old.data is not null and new.data is distinct from old.data then
    raise exception 'quotation data is frozen' using errcode = 'raise_exception';
  end if;
  if new.order_id is distinct from old.order_id
    or new.quotation_number is distinct from old.quotation_number
    or new.quotation_date is distinct from old.quotation_date
    or new.valid_till is distinct from old.valid_till then
    raise exception 'quotation identity is immutable' using errcode = 'raise_exception';
  end if;
  return new;
end;
$$;

drop trigger if exists quotations_freeze_data on public.quotations;
create trigger quotations_freeze_data
  before update on public.quotations
  for each row execute function public.freeze_quotation_data();

-- ─── Access: service role + admins only (mirror invoices/orders) ────
alter table public.quotations enable row level security;

grant all on public.quotations to authenticated;

create policy quotations_admin_all
  on public.quotations for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant usage, select on sequence public.quotation_number_seq to service_role;

-- ─── QUOTATION_ISSUED event type (additive CHECK widening) ──────────
alter table public.order_events
  drop constraint if exists order_events_type_check;
alter table public.order_events
  add constraint order_events_type_check check (
    event_type in (
      'ORDER_CREATED', 'PAYMENT_SUBMITTED', 'PAYMENT_VERIFIED',
      'PAYMENT_REJECTED', 'ORDER_CONFIRMED', 'PROCESSING_STARTED',
      'PACKED', 'READY_FOR_DISPATCH', 'DISPATCHED', 'DELIVERED',
      'CANCELLED', 'INVOICE_ISSUED', 'QUOTATION_ISSUED', 'STATUS_CHANGED'
    )
  );

-- ─── create_order(): persist the HSN snapshot (6-arg live overload) ─
-- Body identical to 0021 plus hsn_snapshot on order_items.
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

  insert into public.customers (name, phone, email, gstin)
  values (
    p_customer ->> 'name',
    p_customer ->> 'phone',
    nullif(p_customer ->> 'email', ''),
    nullif(p_customer ->> 'gstin', '')
  )
  on conflict (phone) do update set
    name = excluded.name,
    email = coalesce(excluded.email, public.customers.email),
    gstin = coalesce(excluded.gstin, public.customers.gstin),
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
    stock_state, delivery_weight_kg, delivery_rule_summary
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
    nullif(p_order ->> 'delivery_rule_summary', '')
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
