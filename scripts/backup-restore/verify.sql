-- =====================================================================
-- Backup/restore drill — read-only verification queries
-- =====================================================================
-- Run IDENTICALLY against the source database and the restored target,
-- then compare the output. Every query is read-only.
--
--   psql "$URL" -v ON_ERROR_STOP=1 -At -f verify.sql
--
-- Section 1: per-table row count + deterministic content checksum.
-- Section 2: foreign-key / relationship integrity (expect 0).
-- Section 3: financial + operational invariants (expect 0).
-- Section 4: schema-object fingerprint (indexes, constraints, triggers,
--            functions, RLS policies, grants).
-- =====================================================================

\echo ==SECTION 1: counts + checksums==

with t as (
  select 'customers' tbl, count(*)::bigint n,
         md5(coalesce(string_agg(c::text, E'\n' order by c.id), '')) ck from public.customers c
  union all select 'products', count(*),
         md5(coalesce(string_agg(p::text, E'\n' order by p.id), '')) from public.products p
  union all select 'delivery_partners', count(*),
         md5(coalesce(string_agg(d::text, E'\n' order by d.id), '')) from public.delivery_partners d
  union all select 'delivery_pincode_rates', count(*),
         md5(coalesce(string_agg(r::text, E'\n' order by r.id), '')) from public.delivery_pincode_rates r
  union all select 'delivery_weight_slabs', count(*),
         md5(coalesce(string_agg(s::text, E'\n' order by s.id), '')) from public.delivery_weight_slabs s
  union all select 'delivery_category_rules', count(*),
         md5(coalesce(string_agg(k::text, E'\n' order by k.id), '')) from public.delivery_category_rules k
  union all select 'orders', count(*),
         md5(coalesce(string_agg(o::text, E'\n' order by o.id), '')) from public.orders o
  union all select 'order_items', count(*),
         md5(coalesce(string_agg(i::text, E'\n' order by i.id), '')) from public.order_items i
  union all select 'payments', count(*),
         md5(coalesce(string_agg(y::text, E'\n' order by y.id), '')) from public.payments y
  union all select 'invoices', count(*),
         md5(coalesce(string_agg(v::text, E'\n' order by v.id), '')) from public.invoices v
  union all select 'stock_reservations', count(*),
         md5(coalesce(string_agg(q::text, E'\n' order by q.id), '')) from public.stock_reservations q
  union all select 'inventory_events', count(*),
         md5(coalesce(string_agg(w::text, E'\n' order by w.id), '')) from public.inventory_events w
  union all select 'shipments', count(*),
         md5(coalesce(string_agg(h::text, E'\n' order by h.id), '')) from public.shipments h
  union all select 'order_events', count(*),
         md5(coalesce(string_agg(x::text, E'\n' order by x.id), '')) from public.order_events x
  union all select 'order_access_tokens', count(*),
         md5(coalesce(string_agg(j::text, E'\n' order by j.id), '')) from public.order_access_tokens j
  union all select 'staff_notes', count(*),
         md5(coalesce(string_agg(m::text, E'\n' order by m.id), '')) from public.staff_notes m
  union all select 'admin_audit_log', count(*),
         md5(coalesce(string_agg(g::text, E'\n' order by g.id), '')) from public.admin_audit_log g
  union all select 'profiles', count(*),
         md5(coalesce(string_agg(z::text, E'\n' order by z.id), '')) from public.profiles z
)
select tbl || ' | rows=' || n || ' | md5=' || ck from t order by tbl;

\echo ==SECTION 2: relationship integrity (expect 0)==

select 'orders->customers' k, count(*)::text v from public.orders o
  left join public.customers c on c.id = o.customer_id where c.id is null
union all
select 'order_items->orders', count(*)::text from public.order_items i
  left join public.orders o on o.id = i.order_id where o.id is null
union all
select 'order_items->products', count(*)::text from public.order_items i
  left join public.products p on p.id = i.product_id where i.product_id is not null and p.id is null
union all
select 'payments->orders', count(*)::text from public.payments y
  left join public.orders o on o.id = y.order_id where o.id is null
union all
select 'invoices->orders', count(*)::text from public.invoices v
  left join public.orders o on o.id = v.order_id where o.id is null
union all
select 'shipments->orders', count(*)::text from public.shipments h
  left join public.orders o on o.id = h.order_id where o.id is null
union all
select 'reservations->orders', count(*)::text from public.stock_reservations q
  left join public.orders o on o.id = q.order_id where o.id is null
union all
select 'reservations->products', count(*)::text from public.stock_reservations q
  left join public.products p on p.id = q.product_id where p.id is null
union all
select 'inventory_events->products', count(*)::text from public.inventory_events w
  left join public.products p on p.id = w.product_id where p.id is null
union all
select 'order_events->orders', count(*)::text from public.order_events x
  left join public.orders o on o.id = x.order_id where o.id is null
union all
select 'staff_notes->order(entity)', count(*)::text from public.staff_notes m
  where m.entity_type = 'order'
    and not exists (select 1 from public.orders o where o.id = m.entity_id)
union all
select 'access_tokens->orders', count(*)::text from public.order_access_tokens j
  left join public.orders o on o.id = j.order_id where o.id is null
union all
select 'orders->delivery_partners', count(*)::text from public.orders o
  left join public.delivery_partners d on d.id = o.delivery_partner_id
  where o.delivery_partner_id is not null and d.id is null
union all
select 'shipments->delivery_partners', count(*)::text from public.shipments s
  left join public.delivery_partners d on d.id = s.delivery_partner_id
  where s.delivery_partner_id is not null and d.id is null
union all
select 'pincode_rates->delivery_partners', count(*)::text from public.delivery_pincode_rates r
  left join public.delivery_partners d on d.id = r.delivery_partner_id where d.id is null
union all
select 'weight_slabs->delivery_partners', count(*)::text from public.delivery_weight_slabs s
  left join public.delivery_partners d on d.id = s.delivery_partner_id where d.id is null
union all
select 'inventory_events->orders', count(*)::text from public.inventory_events w
  left join public.orders o on o.id = w.order_id where w.order_id is not null and o.id is null
union all
select 'profiles->auth.users (cross-schema)', count(*)::text from public.profiles p
  left join auth.users u on u.id = p.id where u.id is null
order by 1;

\echo ==SECTION 3: financial + operational invariants (expect 0)==

select 'order_total_identity' k, count(*)::text v from public.orders
  where total_amount <> subtotal + delivery_charge + cgst_amount + sgst_amount + igst_amount
union all
select 'order_item_line_total_math', count(*)::text from public.order_items
  where line_total <> quantity * unit_price
union all
select 'order_item_tax_base', count(*)::text from public.order_items
  where line_tax_amount <> round(line_total * gst_rate_percent / 100.0, 2)
union all
select 'invoice_total_matches_order', count(*)::text from public.invoices v
  join public.orders o on o.id = v.order_id
  where (v.data->'totals'->>'total')::numeric <> o.total_amount
union all
select 'paid_order_has_verified_payment', count(*)::text from public.orders o
  where o.payment_status = 'paid'
    and not exists (select 1 from public.payments y
                    where y.order_id = o.id and y.status = 'paid')
union all
select 'paid_payment_amount_matches_order', count(*)::text from public.payments y
  join public.orders o on o.id = y.order_id
  where y.status = 'paid' and y.amount <> o.total_amount
union all
select 'invoice_order_matches_items', count(*)::text from public.invoices v
  join public.orders o on o.id = v.order_id
  where (v.data->'totals'->>'subtotal')::numeric <> o.subtotal
union all
select 'reserved_stock_matches_open_reservations', count(*)::text from public.orders o
  where o.stock_state = 'reserved'
    and not exists (select 1 from public.stock_reservations q
                    where q.order_id = o.id and q.status = 'held')
union all
select 'active_reservation_has_inventory_event', count(*)::text from public.stock_reservations q
  where q.status = 'held'
    and not exists (select 1 from public.inventory_events w
                    where w.order_id = q.order_id and w.product_id = q.product_id
                      and w.event = 'reserved')
union all
select 'shipment_status_event_consistency', count(*)::text from public.shipments h
  join public.orders o on o.id = h.order_id
  where h.dispatch_status = 'delivered' and o.order_status <> 'delivered'
union all
select 'event_type_status_valid', count(*)::text from public.order_events x
  where x.event_type not in ('ORDER_CREATED','PAYMENT_SUBMITTED','PAYMENT_VERIFIED',
    'PAYMENT_REJECTED','ORDER_CONFIRMED','PROCESSING_STARTED','PACKED',
    'READY_FOR_DISPATCH','DISPATCHED','DELIVERED','CANCELLED','INVOICE_ISSUED',
    'STATUS_CHANGED')
union all
select 'event_actor_valid', count(*)::text from public.order_events
  where actor_type not in ('customer','admin','system')
order by 1;

\echo ==SECTION 4: schema-object fingerprint==

select 'indexes' k, count(*)::text v from pg_indexes where schemaname = 'public'
union all
select 'check_constraints', count(*)::text from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public' and con.contype = 'c'
union all
select 'foreign_keys', count(*)::text from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public' and con.contype = 'f'
union all
select 'unique_constraints', count(*)::text from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public' and con.contype = 'u'
union all
select 'triggers', count(*)::text from information_schema.triggers where trigger_schema = 'public'
union all
select 'public_functions', count(*)::text from pg_proc pr
  join pg_namespace n on n.oid = pr.pronamespace where n.nspname = 'public'
union all
select 'rls_tables', count(*)::text from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
union all
select 'rls_policies', count(*)::text from pg_policies where schemaname = 'public'
union all
select 'table_grants', count(*)::text from information_schema.role_table_grants
  where table_schema = 'public';

-- Fingerprint of constraint/trigger/policy definitions, so a restore
-- that silently changes a rule is detectable, not just a count drift.
\echo ==SECTION 4b: definition fingerprint==

select md5(string_agg(def, E'\n' order by def)) from (
  select rel.relname || ':' || con.conname || ':' || pg_get_constraintdef(con.oid) def
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public'
  union all
  select event_object_table || ':' || trigger_name || ':' || action_timing || ':' || event_manipulation
  from information_schema.triggers where trigger_schema = 'public'
  union all
  select schemaname || ':' || tablename || ':' || policyname || ':' || cmd
  from pg_policies where schemaname = 'public'
) d;
