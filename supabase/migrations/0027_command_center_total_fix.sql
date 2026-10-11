-- Trolift Solutions — 0027 command-center total fix
--
-- Staging verification (Prompt 43) proved get_admin_command_center()
-- fails on live PostgreSQL for EVERY caller (admin included):
--   function sum(text) does not exist
-- jsonb_each_text() yields text values; sum() has no text overload, so
-- planning the `total_orders` subquery always errors — even on an empty
-- order table. Fix: cast before aggregating. Forward migration only;
-- 0024 itself is untouched.
--
-- Verified live: admin call succeeds post-fix (see staging report).

create or replace function public.get_admin_command_center(
  p_timezone text default 'Asia/Kolkata',
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_tz text := 'UTC';
  v_today_start timestamptz;
  v_today_end timestamptz;
  v_week_ago timestamptz := now() - interval '7 days';
  v_counts jsonb;
  v_paid_rev numeric(14, 2);
  v_paid_orders integer;
  v_cancelled integer;
  v_repeat integer;
  v_today_created integer;
  v_today_verified integer;
  v_today_processed integer;
  v_today_dispatched integer;
  v_today_delivered integer;
  v_low_stock integer;
  v_out_of_stock integer;
  v_claims jsonb;
  v_queue_items jsonb;
  v_delayed jsonb;
  v_low_stock_items jsonb;
  v_failed jsonb;
  v_recent jsonb;
  v_recent_total bigint;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 5), 50);
  v_offset integer;
  v_total_orders integer;
begin
  if not public.is_admin() then
    raise exception 'admin access required' using errcode = 'insufficient_privilege';
  end if;

  -- Validate the timezone; fall back to UTC on garbage input.
  begin
    perform now() at time zone p_timezone;
    v_tz := p_timezone;
  exception when others then
    v_tz := 'UTC';
  end;
  v_today_start :=
    (date_trunc('day', now() at time zone v_tz)) at time zone v_tz;
  v_today_end := v_today_start + interval '1 day';
  v_offset := (v_page - 1) * v_size;

  -- ── Status counts (one grouped scan feeds every order queue) ──────
  select coalesce(jsonb_object_agg(order_status, cnt), '{}'::jsonb)
  into v_counts
  from (
    select o.order_status, count(*)::integer as cnt
    from public.orders o
    group by o.order_status
  ) s;

  -- Total across statuses. NOTE (was: sum(value) over text → runtime
  -- error on every call): cast each value before aggregating.
  select coalesce(sum(e.value::integer), 0)::integer
  into v_total_orders
  from jsonb_each_text(v_counts) as e(key, value);

  -- ── Business summary aggregates (single pass over orders) ─────────
  select
    coalesce(sum(case when o.payment_status = 'paid' then o.total_amount end), 0)::numeric(14, 2),
    count(*) filter (where o.payment_status = 'paid')::integer,
    count(*) filter (where o.order_status = 'cancelled')::integer,
    count(*) filter (
      where o.customer_id in (
        select o2.customer_id
        from public.orders o2
        where o2.payment_status = 'paid'
        group by o2.customer_id
        having count(*) > 1
      ) and o.payment_status = 'paid'
    )::integer
  into v_paid_rev, v_paid_orders, v_cancelled, v_repeat
  from public.orders o;

  -- ── Low stock (on-hand vs threshold; active products only) ────────
  select
    count(*) filter (
      where p.is_active
        and p.stock_quantity > 0
        and p.stock_quantity <= p.low_stock_threshold
    )::integer,
    count(*) filter (
      where p.is_active and p.stock_quantity <= 0
    )::integer
  into v_low_stock, v_out_of_stock
  from public.products p;

  -- ── Today's operations (business timezone boundaries) ─────────────
  select
    (select count(*) from public.orders o
      where o.created_at >= v_today_start and o.created_at < v_today_end)::integer,
    (select count(*) from public.payments pay
      where pay.status = 'paid'
        and pay.updated_at >= v_today_start and pay.updated_at < v_today_end)::integer,
    (select count(*) from public.order_events e
      where e.event_type = 'PROCESSING_STARTED'
        and e.created_at >= v_today_start and e.created_at < v_today_end)::integer,
    (select count(*) from public.shipments sh
      where sh.dispatched_at is not null
        and sh.dispatched_at >= v_today_start and sh.dispatched_at < v_today_end)::integer,
    (select count(*) from public.shipments sh
      where sh.delivered_at is not null
        and sh.delivered_at >= v_today_start and sh.delivered_at < v_today_end)::integer
  into v_today_created, v_today_verified, v_today_processed,
       v_today_dispatched, v_today_delivered;

  -- ── Queue: payment claims awaiting verification ───────────────────
  select coalesce(jsonb_agg(t), '[]'::jsonb)
  into v_claims
  from (
    select jsonb_build_object(
      'order_id', o.id,
      'order_number', o.order_number,
      'amount', pay.amount,
      'customer_name', c.name,
      'reference', pay.transaction_reference,
      'submitted_at', pay.updated_at
    ) as t
    from public.payments pay
    join public.orders o on o.id = pay.order_id
    join public.customers c on c.id = o.customer_id
    where pay.status = 'submitted'
    order by pay.updated_at asc
    limit 10
  ) sub;

  -- ── Queue items: latest 5 per fulfilment status, one query ────────
  select coalesce(jsonb_object_agg(s.status, s.items), '{}'::jsonb)
  into v_queue_items
  from (
    select x.order_status as status,
      jsonb_agg(jsonb_build_object(
        'order_id', x.id,
        'order_number', x.order_number,
        'customer_name', x.cname,
        'total_amount', x.total_amount,
        'payment_status', x.payment_status,
        'created_at', x.created_at
      ) order by x.created_at desc) as items
    from (
      select o.id, o.order_number, c.name as cname, o.total_amount,
        o.payment_status, o.order_status, o.created_at,
        row_number() over (partition by o.order_status order by o.created_at desc) as rn
      from public.orders o
      join public.customers c on c.id = o.customer_id
      where o.order_status in
        ('confirmed', 'paid', 'processing', 'packed', 'ready_for_dispatch')
    ) x
    where x.rn <= 5
    group by x.order_status
  ) s;

  -- ── Queue: delayed shipments (past expected delivery, not done) ───
  select coalesce(jsonb_agg(t), '[]'::jsonb)
  into v_delayed
  from (
    select jsonb_build_object(
      'shipment_id', sh.id,
      'order_id', o.id,
      'order_number', o.order_number,
      'customer_name', c.name,
      'dispatch_status', sh.dispatch_status,
      'expected_delivery_date', sh.expected_delivery_date,
      'dispatched_at', sh.dispatched_at
    ) as t
    from public.shipments sh
    join public.orders o on o.id = sh.order_id
    join public.customers c on c.id = o.customer_id
    where sh.dispatch_status in ('dispatched', 'in_transit')
      and sh.expected_delivery_date is not null
      and sh.expected_delivery_date < now()
      and sh.delivered_at is null
    order by sh.expected_delivery_date asc
    limit 10
  ) sub;

  -- ── Queue: low/out-of-stock products ──────────────────────────────
  select coalesce(jsonb_agg(t), '[]'::jsonb)
  into v_low_stock_items
  from (
    select jsonb_build_object(
      'product_id', p.id,
      'name', p.name,
      'stock_quantity', p.stock_quantity,
      'low_stock_threshold', p.low_stock_threshold
    ) as t
    from public.products p
    where p.is_active
      and p.stock_quantity <= p.low_stock_threshold
    order by p.stock_quantity asc, p.name asc
    limit 10
  ) sub;

  -- ── Queue: failed payments (operational errors, last 7 days) ──────
  select coalesce(jsonb_agg(t), '[]'::jsonb)
  into v_failed
  from (
    select jsonb_build_object(
      'order_id', o.id,
      'order_number', o.order_number,
      'customer_name', c.name,
      'amount', pay.amount,
      'payment_status', pay.status,
      'updated_at', pay.updated_at
    ) as t
    from public.payments pay
    join public.orders o on o.id = pay.order_id
    join public.customers c on c.id = o.customer_id
    where pay.status = 'failed'
      and pay.updated_at >= v_week_ago
    order by pay.updated_at desc
    limit 10
  ) sub;

  -- ── Recent orders (paginated, with shipment status) ───────────────
  select count(*) into v_recent_total from public.orders o;

  select coalesce(jsonb_agg(t), '[]'::jsonb)
  into v_recent
  from (
    select jsonb_build_object(
      'order_id', o.id,
      'order_number', o.order_number,
      'customer_name', c.name,
      'total_amount', o.total_amount,
      'payment_status', o.payment_status,
      'order_status', o.order_status,
      'dispatch_status', sh.dispatch_status,
      'created_at', o.created_at
    ) as t
    from public.orders o
    join public.customers c on c.id = o.customer_id
    left join public.shipments sh on sh.order_id = o.id
    order by o.created_at desc
    limit v_size offset v_offset
  ) sub;

  return jsonb_build_object(
    'today', jsonb_build_object(
      'orders_created', v_today_created,
      'payments_verified', v_today_verified,
      'orders_processed', v_today_processed,
      'shipments_dispatched', v_today_dispatched,
      'deliveries_completed', v_today_delivered
    ),
    'summary', jsonb_build_object(
      'total_orders', v_total_orders,
      'paid_orders', v_paid_orders,
      'paid_revenue', v_paid_rev,
      'avg_order_value', case
        when v_paid_orders > 0 then round(v_paid_rev / v_paid_orders, 2)
        else 0 end,
      'cancelled_orders', v_cancelled,
      'repeat_customers', v_repeat,
      'low_stock_count', v_low_stock,
      'out_of_stock_count', v_out_of_stock
    ),
    'queues', jsonb_build_object(
      'claims', jsonb_build_object(
        'count', (select count(*) from public.payments pay where pay.status = 'submitted')::integer,
        'items', v_claims),
      'confirmed', jsonb_build_object(
        'count', coalesce(v_counts ->> 'confirmed', '0')::integer,
        'items', coalesce(v_queue_items -> 'confirmed', '[]'::jsonb)),
      'paid', jsonb_build_object(
        'count', coalesce(v_counts ->> 'paid', '0')::integer,
        'items', coalesce(v_queue_items -> 'paid', '[]'::jsonb)),
      'processing', jsonb_build_object(
        'count', coalesce(v_counts ->> 'processing', '0')::integer,
        'items', coalesce(v_queue_items -> 'processing', '[]'::jsonb)),
      'packed', jsonb_build_object(
        'count', coalesce(v_counts ->> 'packed', '0')::integer,
        'items', coalesce(v_queue_items -> 'packed', '[]'::jsonb)),
      'ready_for_dispatch', jsonb_build_object(
        'count', coalesce(v_counts ->> 'ready_for_dispatch', '0')::integer,
        'items', coalesce(v_queue_items -> 'ready_for_dispatch', '[]'::jsonb)),
      'delayed_shipments', jsonb_build_object(
        'count', (select count(*) from public.shipments sh
          where sh.dispatch_status in ('dispatched', 'in_transit')
            and sh.expected_delivery_date is not null
            and sh.expected_delivery_date < now()
            and sh.delivered_at is null)::integer,
        'items', v_delayed),
      'low_stock', jsonb_build_object(
        'count', v_low_stock + v_out_of_stock,
        'items', v_low_stock_items),
      'failed_payments', jsonb_build_object(
        'count', (select count(*) from public.payments pay
          where pay.status = 'failed'
            and pay.updated_at >= v_week_ago)::integer,
        'items', v_failed)
    ),
    'recent_orders', jsonb_build_object(
      'total', v_recent_total,
      'page', v_page,
      'page_size', v_size,
      'items', v_recent
    )
  );
end;
$$;

revoke all on function public.get_admin_command_center(text, integer, integer) from public;
grant execute on function public.get_admin_command_center(text, integer, integer) to authenticated;
