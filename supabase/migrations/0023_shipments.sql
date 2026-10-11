-- Shipment/dispatch management table
-- One shipment per order (1:1). Shipment status is separate from order status.

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  delivery_partner_id uuid references public.delivery_partners(id) on delete set null,
  tracking_reference text,
  dispatch_status text not null default 'not_ready'
    check (dispatch_status in ('not_ready', 'ready', 'dispatched', 'in_transit', 'delivered')),
  dispatched_at timestamptz,
  expected_delivery_date timestamptz,
  delivered_at timestamptz,
  dispatch_notes text check (char_length(dispatch_notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for admin listing by status
create index if not exists shipments_status_idx on public.shipments (dispatch_status);
create index if not exists shipments_order_idx on public.shipments (order_id);
create index if not exists shipments_partner_idx on public.shipments (delivery_partner_id);

-- RLS
alter table public.shipments enable row level security;

-- Admin-only access (same pattern as other admin tables)
create policy "shipments_admin_all" on public.shipments
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Trigger for updated_at
create trigger shipments_set_updated_at
  before update on public.shipments
  for each row execute function public.set_updated_at();
