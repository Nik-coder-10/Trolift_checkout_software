-- Performance indexes for common query patterns
-- These indexes are justified by actual query patterns in the codebase

-- Orders: customer order history (customer detail page, order tracking)
create index if not exists orders_customer_created_idx
  on public.orders (customer_id, created_at desc);

-- Orders: admin filtering by payment + order status (admin order list)
create index if not exists orders_payment_status_order_status_idx
  on public.orders (payment_status, order_status);

-- Orders: admin filtering by order status + created_at (admin list with status filter)
create index if not exists orders_status_created_idx
  on public.orders (order_status, created_at desc);

-- Delivery pincode rates: composite for delivery lookups (pincode + partner + serviceable)
create index if not exists pincode_rates_pincode_partner_serviceable_idx
  on public.delivery_pincode_rates (pincode, delivery_partner_id, serviceable);

-- Products: catalogue browsing (is_active + category + created_at for featured/newest)
create index if not exists products_active_category_created_idx
  on public.products (is_active, category, created_at desc);

-- Products: price sorting (is_active + price for price_asc/price_desc sorts)
create index if not exists products_active_price_idx
  on public.products (is_active, price);

-- Products: name sorting (is_active + name for name_asc sort)
create index if not exists products_active_name_idx
  on public.products (is_active, name);

-- Order events: fulfillment checks (order_id + event_type for packed/ready checks)
create index if not exists order_events_order_type_idx
  on public.order_events (order_id, event_type);

-- Stock reservations: availability checks (product_id + status + expires_at)
create index if not exists stock_reservations_product_status_expiry_idx
  on public.stock_reservations (product_id, status, expires_at);

-- Inventory events: product history (product_id + created_at desc)
create index if not exists inventory_events_product_created_idx
  on public.inventory_events (product_id, created_at desc);

-- Payments: order payment lookup (order_id + created_at desc for latest payment)
create index if not exists payments_order_created_idx
  on public.payments (order_id, created_at desc);

-- Customers: admin search (name, phone, email, gstin) - trigram index
create index if not exists customers_name_trgm_idx
  on public.customers using gin (name gin_trgm_ops);

-- Customers: phone search
create index if not exists customers_phone_trgm_idx
  on public.customers using gin (phone gin_trgm_ops);
