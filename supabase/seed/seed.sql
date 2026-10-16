-- Trolift Solutions — development seed
--
-- Deterministic (fixed UUIDs) and idempotent (ON CONFLICT DO NOTHING),
-- so it is safe to re-run. All people/companies are fictional; phone
-- numbers and e-mails are obviously fake. No real customer PII.
--
-- Covers: 5 delivery partners, 8 products, 7 pincodes, several partners
-- per pincode with different charges, and serviceable / non-serviceable
-- scenarios (600001/BlueDart, 799001 remote).

begin;

-- ─── Delivery partners ────────────────────────────────────────────────
insert into public.delivery_partners
  (id, name, contact_name, contact_phone, contact_email, is_active)
values
  ('a1b2c3d4-0001-4000-8000-000000000001', 'Delhivery', 'Ops Desk', '+911800123456', 'ops@example-delhivery.in', true),
  ('a1b2c3d4-0002-4000-8000-000000000002', 'XpressBees', 'Ops Desk', '+911800234567', 'ops@example-xpressbees.in', true),
  ('a1b2c3d4-0003-4000-8000-000000000003', 'BlueDart', 'Ops Desk', '+911800345678', 'ops@example-bluedart.in', true),
  ('a1b2c3d4-0004-4000-8000-000000000004', 'DTDC', 'Ops Desk', '+911800456789', 'ops@example-dtdc.in', true),
  ('a1b2c3d4-0005-4000-8000-000000000005', 'GATI Freight', 'Ops Desk', '+911800567890', 'ops@example-gati.in', true)
on conflict (id) do nothing;

-- ─── Products ─────────────────────────────────────────────────────────
insert into public.products
  (id, name, slug, description, category, specifications, price, stock_quantity, weight_kg, gst_rate, images, is_active)
values
  (
    'b1c2d3e4-0001-4000-8000-000000000001',
    'Hydraulic Hand Pallet Truck 2500 kg',
    'hydraulic-hand-pallet-truck-2500kg',
    'Heavy-duty hydraulic hand pallet truck for warehouses and loading bays. Sealed hydraulics, overload valve and 180-degree steering arc.',
    'Pallet Handling',
    '{"capacity_kg": 2500, "fork_length_mm": 1150, "fork_width_mm": 540, "min_height_mm": 85, "max_height_mm": 200, "wheel": "polyurethane"}',
    24999.00, 42, 68.000, 18.00,
    array['/images/products/hydraulic-hand-pallet-truck-2500kg-1.jpg'],
    true
  ),
  (
    'b1c2d3e4-0002-4000-8000-000000000002',
    'Electric Pallet Stacker 1500 kg',
    'electric-pallet-stacker-1500kg',
    'Battery-operated pallet stacker with 3 m lift height for racking and truck loading. Includes charger and hour meter.',
    'Lifting & Stacking',
    '{"capacity_kg": 1500, "lift_height_m": 3.0, "battery": "24V 210Ah", "charger": "inbuilt", "aisle_width_mm": 2200}',
    285000.00, 8, 890.000, 18.00,
    array['/images/products/electric-pallet-stacker-1500kg-1.jpg'],
    true
  ),
  (
    'b1c2d3e4-0003-4000-8000-000000000003',
    'Hydraulic Scissor Lift Table 1000 kg',
    'hydraulic-scissor-lift-table-1000kg',
    'Mobile scissor lift table for ergonomic loading at assembly lines. Foot-operated hydraulics with safety locking.',
    'Lifting & Stacking',
    '{"capacity_kg": 1000, "table_size_mm": "1300x800", "lift_height_mm": 1000, "operation": "foot pedal hydraulic"}',
    78500.00, 15, 210.000, 18.00,
    array['/images/products/hydraulic-scissor-lift-table-1000kg-1.jpg'],
    true
  ),
  (
    'b1c2d3e4-0004-4000-8000-000000000004',
    'Heavy-Duty Platform Trolley 500 kg',
    'heavy-duty-platform-trolley-500kg',
    'Steel-deck platform trolley with foldable handle and puncture-proof wheels for shop floors and godowns.',
    'Trolleys',
    '{"capacity_kg": 500, "deck_size_mm": "1200x700", "wheels": "puncture-proof rubber", "handle": "foldable"}',
    6299.00, 120, 32.000, 18.00,
    array['/images/products/heavy-duty-platform-trolley-500kg-1.jpg'],
    true
  ),
  (
    'b1c2d3e4-0005-4000-8000-000000000005',
    'Oil Drum Handler Trolley',
    'oil-drum-handler-trolley',
    'Four-wheel drum handler for 210-litre MS and plastic drums. Grips, lifts and transports without spillage.',
    'Drum Handling',
    '{"drum_litres": 210, "capacity_kg": 350, "wheels": 4, "finish": "powder-coated"}',
    12750.00, 30, 41.500, 18.00,
    array['/images/products/oil-drum-handler-trolley-1.jpg'],
    true
  ),
  (
    'b1c2d3e4-0006-4000-8000-000000000006',
    'Manual Chain Pulley Block 2 Tonne',
    'manual-chain-pulley-block-2t',
    '2-tonne chain pulley block with 3 m standard lift for workshops and site erection work. Tested with certificate.',
    'Lifting & Stacking',
    '{"capacity_t": 2, "lift_height_m": 3, "standard": "IS 3832", "test_certificate": true}',
    8999.00, 55, 18.250, 18.00,
    array['/images/products/manual-chain-pulley-block-2t-1.jpg'],
    true
  ),
  (
    'b1c2d3e4-0007-4000-8000-000000000007',
    'Hydraulic Dock Leveler 6 Tonne',
    'hydraulic-dock-leveler-6t',
    'Pit-mounted hydraulic dock leveler bridging dock and truck bed. Push-button operation with lip extension.',
    'Dock Equipment',
    '{"capacity_t": 6, "platform_mm": "2000x2500", "operation": "electro-hydraulic", "lip_mm": 400}',
    145000.00, 5, 1250.000, 18.00,
    array['/images/products/hydraulic-dock-leveler-6t-1.jpg'],
    true
  ),
  (
    'b1c2d3e4-0008-4000-8000-000000000008',
    'Electric Tow Tractor 3 Tonne',
    'electric-tow-tractor-3t',
    'Ride-on electric tow tractor for moving multi-trailer trains across large plants. Opportunity charging.',
    'Material Movement',
    '{"towing_capacity_t": 3, "battery": "48V", "drive": "AC motor", "max_speed_kmh": 12}',
    325000.00, 4, 1480.000, 18.00,
    array['/images/products/electric-tow-tractor-3t-1.jpg'],
    true
  )
on conflict (id) do nothing;

-- ─── Pincode rates / serviceability ─────────────────────────────────────
-- Same pincode × several partners with different charges (400001, 110001…),
-- premium/min-order rows (BlueDart, GATI Freight) and non-serviceable
-- scenarios (600001 × BlueDart, remote 799001).
insert into public.delivery_pincode_rates
  (pincode, delivery_partner_id, serviceable, delivery_charge,
   min_order_amount, max_order_amount, eta_min_days, eta_max_days)
values
  -- Mumbai 400001: three partners, three different charges.
  ('400001', 'a1b2c3d4-0001-4000-8000-000000000001', true, 450.00, null, null, 2, 4),
  ('400001', 'a1b2c3d4-0002-4000-8000-000000000002', true, 520.00, null, null, 2, 5),
  ('400001', 'a1b2c3d4-0003-4000-8000-000000000003', true, 890.00, 25000.00, null, 1, 3),
  -- Delhi 110001: standard + economy + freight-with-minimum.
  ('110001', 'a1b2c3d4-0001-4000-8000-000000000001', true, 480.00, null, null, 2, 4),
  ('110001', 'a1b2c3d4-0004-4000-8000-000000000004', true, 390.00, null, null, 3, 6),
  ('110001', 'a1b2c3d4-0005-4000-8000-000000000005', true, 1200.00, 100000.00, null, 3, 6),
  -- Bengaluru 560001: two partners.
  ('560001', 'a1b2c3d4-0001-4000-8000-000000000001', true, 470.00, null, null, 2, 4),
  ('560001', 'a1b2c3d4-0002-4000-8000-000000000002', true, 510.00, null, null, 2, 5),
  -- Chennai 600001: DTDC serves it, BlueDart does not.
  ('600001', 'a1b2c3d4-0004-4000-8000-000000000004', true, 420.00, null, null, 2, 5),
  ('600001', 'a1b2c3d4-0003-4000-8000-000000000003', false, 0.00, null, null, null, null),
  -- Pune 411001: two partners.
  ('411001', 'a1b2c3d4-0002-4000-8000-000000000002', true, 380.00, null, null, 2, 4),
  ('411001', 'a1b2c3d4-0001-4000-8000-000000000001', true, 410.00, null, null, 2, 4),
  -- Hyderabad 500001: two partners.
  ('500001', 'a1b2c3d4-0001-4000-8000-000000000001', true, 460.00, null, null, 2, 5),
  ('500001', 'a1b2c3d4-0004-4000-8000-000000000004', true, 440.00, null, null, 3, 6),
  -- Remote 799001: nobody serves it (negative scenario).
  ('799001', 'a1b2c3d4-0001-4000-8000-000000000001', false, 0.00, null, null, null, null),
  ('799001', 'a1b2c3d4-0005-4000-8000-000000000005', false, 0.00, null, null, null, null)
on conflict (pincode, delivery_partner_id) do nothing;

-- ─── Delivery rule demos ────────────────────────────────────────────
-- Remote surcharge on one live lane (explicit line item at checkout).
update public.delivery_pincode_rates
set remote_surcharge = 120.00
where pincode = '500001'
  and delivery_partner_id = 'a1b2c3d4-0004-4000-8000-000000000004';

-- Weight slabs: 0–10 / 10–25 / 25–50 kg bands (charge replaces base).
insert into public.delivery_weight_slabs
  (delivery_partner_id, min_weight_kg, max_weight_kg, charge)
values
  ('a1b2c3d4-0001-4000-8000-000000000001', 0.000, 10.000, 280.00),
  ('a1b2c3d4-0001-4000-8000-000000000001', 10.000, 25.000, 520.00),
  ('a1b2c3d4-0001-4000-8000-000000000001', 25.000, 50.000, 950.00)
on conflict do nothing;

-- Category handling: flat per-order surcharge for Trolleys.
insert into public.delivery_category_rules (category, surcharge, note)
values ('Trolleys', 250.00, 'oversize handling')
on conflict (category) do nothing;

commit;
