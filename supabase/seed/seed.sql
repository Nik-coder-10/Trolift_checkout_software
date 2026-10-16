-- Trolift Solutions — development seed
--
-- Deterministic (fixed UUIDs) and idempotent (ON CONFLICT DO NOTHING),
-- so it is safe to re-run. All people/companies are fictional; phone
-- numbers and e-mails are obviously fake. No real customer PII.
--
-- Covers: 5 delivery partners, 18 products (live Trolift range — ladders
-- + platform trolleys), 7 pincodes, several partners per pincode with
-- different charges, and serviceable / non-serviceable scenarios
-- (600001/BlueDart, 799001 remote).
--
-- Product prices are DEALER PRICE + ₹500 (price list effective
-- 15/07/2026); GST: ladders 18%, platform trolleys 5%.

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

-- ─── Legacy demo products ─────────────────────────────────────────────
-- The original eight demo rows are deactivated, never deleted:
-- order history references them with ON DELETE RESTRICT. Fresh databases
-- simply skip this (no rows to hide).
update public.products
   set is_active = false
 where id in (
   'b1c2d3e4-0001-4000-8000-000000000001',
   'b1c2d3e4-0002-4000-8000-000000000002',
   'b1c2d3e4-0003-4000-8000-000000000003',
   'b1c2d3e4-0004-4000-8000-000000000004',
   'b1c2d3e4-0005-4000-8000-000000000005',
   'b1c2d3e4-0006-4000-8000-000000000006',
   'b1c2d3e4-0007-4000-8000-000000000007',
   'b1c2d3e4-0008-4000-8000-000000000008'
 );

-- ─── Products (live range) ────────────────────────────────────────────
insert into public.products
  (id, name, slug, description, category, specifications, price,
   stock_quantity, weight_kg, gst_rate, images, is_active, created_at)
values
  (
    'c7d8e9f0-0001-4000-8000-000000000001',
    'Telescopic Ladder TALT-032 (3.2 Mtr / 10.5 Ft)',
    'talt-032',
    'Telescopic ladder TALT-032 — extends to 3.2 m (10.5 ft) with 11 steps at 30 cm step distance, 9 kg. Collapses for compact carry and storage.',
    'Ladders',
    '{"model": "TALT-032", "ladder_type": "Telescopic", "steps": 11, "step_distance_cm": 30, "extended_height": "3.2 Mtr (10.5 Ft)", "weight_kg": 9}',
    5790.00, 50, 9.000, 18.00, '{}', true, now()
  ),
  (
    'c7d8e9f0-0002-4000-8000-000000000002',
    'Telescopic Ladder TALT-038 (3.8 Mtr / 12.5 Ft)',
    'talt-038',
    'Telescopic ladder TALT-038 — extends to 3.8 m (12.5 ft) with 13 steps at 30 cm step distance, 11 kg. Collapses for compact carry and storage.',
    'Ladders',
    '{"model": "TALT-038", "ladder_type": "Telescopic", "steps": 13, "step_distance_cm": 30, "extended_height": "3.8 Mtr (12.5 Ft)", "weight_kg": 11}',
    6990.00, 50, 11.000, 18.00, '{}', true, now() - interval '1 minute'
  ),
  (
    'c7d8e9f0-0003-4000-8000-000000000003',
    'Telescopic Ladder TALT-044 (4.4 Mtr / 15 Ft)',
    'talt-044',
    'Telescopic ladder TALT-044 — extends to 4.4 m (15 ft) with 15 steps at 30 cm step distance, 12.6 kg. Collapses for compact carry and storage.',
    'Ladders',
    '{"model": "TALT-044", "ladder_type": "Telescopic", "steps": 15, "step_distance_cm": 30, "extended_height": "4.4 Mtr (15 Ft)", "weight_kg": 12.6}',
    8090.00, 50, 12.600, 18.00, '{}', true, now() - interval '2 minutes'
  ),
  (
    'c7d8e9f0-0004-4000-8000-000000000004',
    'Telescopic Ladder TALT-055 (5.5 Mtr / 18 Ft)',
    'talt-055',
    'Telescopic ladder TALT-055 — extends to 5.5 m (18 ft) with 14 steps at 40 cm step distance, 14 kg. Collapses for compact carry and storage.',
    'Ladders',
    '{"model": "TALT-055", "ladder_type": "Telescopic", "steps": 14, "step_distance_cm": 40, "extended_height": "5.5 Mtr (18 Ft)", "weight_kg": 14}',
    9290.00, 50, 14.000, 18.00, '{}', true, now() - interval '3 minutes'
  ),
  (
    'c7d8e9f0-0005-4000-8000-000000000005',
    'Telescopic Ladder TALT-060 (6 Mtr / 20 Ft)',
    'talt-060',
    'Telescopic ladder TALT-060 — extends to 6 m (20 ft) with 15 steps at 40 cm step distance, 15.5 kg. Collapses for compact carry and storage.',
    'Ladders',
    '{"model": "TALT-060", "ladder_type": "Telescopic", "steps": 15, "step_distance_cm": 40, "extended_height": "6 Mtr (20 Ft)", "weight_kg": 15.5}',
    10490.00, 50, 15.500, 18.00, '{}', true, now() - interval '4 minutes'
  ),
  (
    'c7d8e9f0-0006-4000-8000-000000000006',
    'Telescopic Ladder TALT-072 (7.2 Mtr / 23.6 Ft)',
    'talt-072',
    'Telescopic ladder TALT-072 — extends to 7.2 m (23.6 ft) with 16 steps at 45 cm step distance, 18.2 kg. Collapses for compact carry and storage.',
    'Ladders',
    '{"model": "TALT-072", "ladder_type": "Telescopic", "steps": 16, "step_distance_cm": 45, "extended_height": "7.2 Mtr (23.6 Ft)", "weight_kg": 18.2}',
    12290.00, 50, 18.200, 18.00, '{}', true, now() - interval '5 minutes'
  ),
  (
    'c7d8e9f0-0007-4000-8000-000000000007',
    'Finger-Protect Telescopic Ladder TALT-F44 (4.4 Mtr / 15 Ft)',
    'talt-f44',
    'Finger-protect telescopic ladder TALT-F44 — extends to 4.4 m (15 ft) with 15 steps at 30 cm step distance, 13.8 kg. Anti-pinch finger guards on every step.',
    'Ladders',
    '{"model": "TALT-F44", "ladder_type": "Telescopic (Finger protect)", "steps": 15, "step_distance_cm": 30, "extended_height": "4.4 Mtr (15 Ft)", "weight_kg": 13.8}',
    8590.00, 50, 13.800, 18.00, '{}', true, now() - interval '6 minutes'
  ),
  (
    'c7d8e9f0-0008-4000-8000-000000000008',
    'Finger-Protect Telescopic Ladder TALT-F55 (5.5 Mtr / 18 Ft)',
    'talt-f55',
    'Finger-protect telescopic ladder TALT-F55 — extends to 5.5 m (18 ft) with 15 steps at 37 cm step distance, 14.9 kg. Anti-pinch finger guards on every step.',
    'Ladders',
    '{"model": "TALT-F55", "ladder_type": "Telescopic (Finger protect)", "steps": 15, "step_distance_cm": 37, "extended_height": "5.5 Mtr (18 Ft)", "weight_kg": 14.9}',
    9990.00, 50, 14.900, 18.00, '{}', true, now() - interval '7 minutes'
  ),
  (
    'c7d8e9f0-0009-4000-8000-000000000009',
    'A-Type Ladder TALT-D44 (4.4 Mtr / 15 Ft)',
    'talt-d44',
    'Double-sided A-type ladder TALT-D44 — 4.4 m (15 ft) working height, 7+7 steps at 30 cm step distance, 16 kg. Self-standing step ladder for two-sided access.',
    'Ladders',
    '{"model": "TALT-D44", "ladder_type": "A-Type", "steps": "7+7", "step_distance_cm": 30, "extended_height": "4.4 Mtr (15 Ft)", "weight_kg": 16}',
    9390.00, 50, 16.000, 18.00, '{}', true, now() - interval '8 minutes'
  ),
  (
    'c7d8e9f0-000a-4000-8000-00000000000a',
    'A-Type Ladder TALT-D56 (5.6 Mtr / 18.5 Ft)',
    'talt-d56',
    'Double-sided A-type ladder TALT-D56 — 5.6 m (18.5 ft) working height, 9+9 steps at 30 cm step distance, 20.7 kg. Self-standing step ladder for two-sided access.',
    'Ladders',
    '{"model": "TALT-D56", "ladder_type": "A-Type", "steps": "9+9", "step_distance_cm": 30, "extended_height": "5.6 Mtr (18.5 Ft)", "weight_kg": 20.7}',
    12490.00, 50, 20.700, 18.00, '{}', true, now() - interval '9 minutes'
  ),
  (
    'c7d8e9f0-000b-4000-8000-00000000000b',
    'A-Type Ladder TALT-D66 (6.6 Mtr / 22 Ft)',
    'talt-d66',
    'Double-sided A-type ladder TALT-D66 — 6.6 m (22 ft) working height, 8+8 steps at 40 cm step distance, 21.2 kg. Self-standing step ladder for two-sided access.',
    'Ladders',
    '{"model": "TALT-D66", "ladder_type": "A-Type", "steps": "8+8", "step_distance_cm": 40, "extended_height": "6.6 Mtr (22 Ft)", "weight_kg": 21.2}',
    13990.00, 50, 21.200, 18.00, '{}', true, now() - interval '10 minutes'
  ),
  (
    'c7d8e9f0-000c-4000-8000-00000000000c',
    'Metal Platform Trolley TMST-150 (150 Kg)',
    'tmst-150',
    'Metal platform trolley TMST-150 — 150 kg capacity, 48*72 platform, 8.0 kg net weight. MS platform with TPR wheels.',
    'Trolleys',
    '{"model": "TMST-150", "capacity_kg": 150, "platform_size": "48*72", "net_weight_kg": 8.0, "material": "MS Platform with TPR"}',
    2999.00, 50, 8.000, 5.00, '{}', true, now() - interval '11 minutes'
  ),
  (
    'c7d8e9f0-000d-4000-8000-00000000000d',
    'Metal Platform Trolley TMST-300 (300 Kg)',
    'tmst-300',
    'Metal platform trolley TMST-300 — 300 kg capacity, 61*91 platform, 13.0 kg net weight. MS platform with TPR wheels.',
    'Trolleys',
    '{"model": "TMST-300", "capacity_kg": 300, "platform_size": "61*91", "net_weight_kg": 13.0, "material": "MS Platform with TPR"}',
    3859.00, 50, 13.000, 5.00, '{}', true, now() - interval '12 minutes'
  ),
  (
    'c7d8e9f0-000e-4000-8000-00000000000e',
    'Metal Platform Trolley TMST-400 (400 Kg)',
    'tmst-400',
    'Metal platform trolley TMST-400 — 400 kg capacity, 60*90 platform, 14.7 kg net weight. MS checkered platform with rubber wheels.',
    'Trolleys',
    '{"model": "TMST-400", "capacity_kg": 400, "platform_size": "60*90", "net_weight_kg": 14.7, "material": "MS checkered With Rubber Wheel"}',
    4999.00, 50, 14.700, 5.00, '{}', true, now() - interval '13 minutes'
  ),
  (
    'c7d8e9f0-000f-4000-8000-00000000000f',
    'Metal Platform Trolley TMST-600 (600 Kg)',
    'tmst-600',
    'Metal platform trolley TMST-600 — 600 kg capacity, 65*110 platform, 21 kg net weight. MS checkered platform with rubber wheels.',
    'Trolleys',
    '{"model": "TMST-600", "capacity_kg": 600, "platform_size": "65*110", "net_weight_kg": 21, "material": "MS checkered With Rubber Wheel"}',
    5990.00, 50, 21.000, 5.00, '{}', true, now() - interval '14 minutes'
  ),
  (
    'c7d8e9f0-0010-4000-8000-000000000010',
    'Plastic Platform Trolley TPT-200 (200 Kg)',
    'tpt-200',
    'Plastic platform trolley TPT-200 — 200 kg capacity, 48*72 platform, 10.2 kg net weight. High-grade HDPE platform trolley.',
    'Trolleys',
    '{"model": "TPT-200", "capacity_kg": 200, "platform_size": "48*72", "net_weight_kg": 10.2, "material": "High-grade HDPE Platform trolley"}',
    3250.00, 50, 10.200, 5.00, '{}', true, now() - interval '15 minutes'
  ),
  (
    'c7d8e9f0-0011-4000-8000-000000000011',
    'Plastic Platform Trolley TPT-400 (400 Kg)',
    'tpt-400',
    'Plastic platform trolley TPT-400 — 400 kg capacity, 60*90 platform, 13.2 kg net weight. High-grade HDPE platform trolley.',
    'Trolleys',
    '{"model": "TPT-400", "capacity_kg": 400, "platform_size": "60*90", "net_weight_kg": 13.2, "material": "High-grade HDPE Platform trolley"}',
    3990.00, 50, 13.200, 5.00, '{}', true, now() - interval '16 minutes'
  ),
  (
    'c7d8e9f0-0012-4000-8000-000000000012',
    'Plastic Platform Trolley TPT-600 (600 Kg)',
    'tpt-600',
    'Plastic platform trolley TPT-600 — 600 kg capacity, 63*105 platform, 16.1 kg net weight. High-grade HDPE platform trolley.',
    'Trolleys',
    '{"model": "TPT-600", "capacity_kg": 600, "platform_size": "63*105", "net_weight_kg": 16.1, "material": "High-grade HDPE Platform trolley"}',
    5690.00, 50, 16.100, 5.00, '{}', true, now() - interval '17 minutes'
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
  ('411001', 'a1b2c3d4-0002-4000-8000-000000000002', true, 380.00, null, null, 2, 5),
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
