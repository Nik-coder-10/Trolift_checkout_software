-- 0034: replace the demo catalogue with the live Trolift product range.
--
-- Source: Trolift Solutions distributor price list effective 15/07/2026
-- (Sitapura, Jaipur). The storefront sells at DEALER PRICE + ₹500
-- (e.g. TALT-032: 4664 + 500 = 5164).
--
-- The previous eight demo products are DEACTIVATED, never deleted:
-- order_items / stock_reservations / inventory_events reference them
-- with ON DELETE RESTRICT, and order history must keep resolving.
-- Inactive rows are hidden from the storefront, search (search_products
-- filters is_active) and RLS (anonymous SELECT requires is_active).
--
-- GST: telescopic / A-type ladders 18%, platform trolleys (metal AND
-- plastic) 5% — matching 0033's per-product rate rule, set explicitly
-- here so the backfill never has to guess.
--
-- Photos arrive separately: images start empty and the branded
-- placeholder renders until the product media is uploaded.
-- Forward-only data migration; idempotent (re-run changes nothing).

begin;

update public.products
   set is_active = false,
       updated_at = now()
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
    5164.00, 50, 9.000, 18.00, '{}', true, now()
  ),
  (
    'c7d8e9f0-0002-4000-8000-000000000002',
    'Telescopic Ladder TALT-038 (3.8 Mtr / 12.5 Ft)',
    'talt-038',
    'Telescopic ladder TALT-038 — extends to 3.8 m (12.5 ft) with 13 steps at 30 cm step distance, 11 kg. Collapses for compact carry and storage.',
    'Ladders',
    '{"model": "TALT-038", "ladder_type": "Telescopic", "steps": 13, "step_distance_cm": 30, "extended_height": "3.8 Mtr (12.5 Ft)", "weight_kg": 11}',
    6051.00, 50, 11.000, 18.00, '{}', true, now() - interval '1 minute'
  ),
  (
    'c7d8e9f0-0003-4000-8000-000000000003',
    'Telescopic Ladder TALT-044 (4.4 Mtr / 15 Ft)',
    'talt-044',
    'Telescopic ladder TALT-044 — extends to 4.4 m (15 ft) with 15 steps at 30 cm step distance, 12.6 kg. Collapses for compact carry and storage.',
    'Ladders',
    '{"model": "TALT-044", "ladder_type": "Telescopic", "steps": 15, "step_distance_cm": 30, "extended_height": "4.4 Mtr (15 Ft)", "weight_kg": 12.6}',
    6966.00, 50, 12.600, 18.00, '{}', true, now() - interval '2 minutes'
  ),
  (
    'c7d8e9f0-0004-4000-8000-000000000004',
    'Telescopic Ladder TALT-055 (5.5 Mtr / 18 Ft)',
    'talt-055',
    'Telescopic ladder TALT-055 — extends to 5.5 m (18 ft) with 14 steps at 40 cm step distance, 14 kg. Collapses for compact carry and storage.',
    'Ladders',
    '{"model": "TALT-055", "ladder_type": "Telescopic", "steps": 14, "step_distance_cm": 40, "extended_height": "5.5 Mtr (18 Ft)", "weight_kg": 14}',
    8000.00, 50, 14.000, 18.00, '{}', true, now() - interval '3 minutes'
  ),
  (
    'c7d8e9f0-0005-4000-8000-000000000005',
    'Telescopic Ladder TALT-060 (6 Mtr / 20 Ft)',
    'talt-060',
    'Telescopic ladder TALT-060 — extends to 6 m (20 ft) with 15 steps at 40 cm step distance, 15.5 kg. Collapses for compact carry and storage.',
    'Ladders',
    '{"model": "TALT-060", "ladder_type": "Telescopic", "steps": 15, "step_distance_cm": 40, "extended_height": "6 Mtr (20 Ft)", "weight_kg": 15.5}',
    8676.00, 50, 15.500, 18.00, '{}', true, now() - interval '4 minutes'
  ),
  (
    'c7d8e9f0-0006-4000-8000-000000000006',
    'Telescopic Ladder TALT-072 (7.2 Mtr / 23.6 Ft)',
    'talt-072',
    'Telescopic ladder TALT-072 — extends to 7.2 m (23.6 ft) with 16 steps at 45 cm step distance, 18.2 kg. Collapses for compact carry and storage.',
    'Ladders',
    '{"model": "TALT-072", "ladder_type": "Telescopic", "steps": 16, "step_distance_cm": 45, "extended_height": "7.2 Mtr (23.6 Ft)", "weight_kg": 18.2}',
    10135.00, 50, 18.200, 18.00, '{}', true, now() - interval '5 minutes'
  ),
  (
    'c7d8e9f0-0007-4000-8000-000000000007',
    'Finger-Protect Telescopic Ladder TALT-F44 (4.4 Mtr / 15 Ft)',
    'talt-f44',
    'Finger-protect telescopic ladder TALT-F44 — extends to 4.4 m (15 ft) with 15 steps at 30 cm step distance, 13.8 kg. Anti-pinch finger guards on every step.',
    'Ladders',
    '{"model": "TALT-F44", "ladder_type": "Telescopic (Finger protect)", "steps": 15, "step_distance_cm": 30, "extended_height": "4.4 Mtr (15 Ft)", "weight_kg": 13.8}',
    6851.00, 50, 13.800, 18.00, '{}', true, now() - interval '6 minutes'
  ),
  (
    'c7d8e9f0-0008-4000-8000-000000000008',
    'Finger-Protect Telescopic Ladder TALT-F55 (5.5 Mtr / 18 Ft)',
    'talt-f55',
    'Finger-protect telescopic ladder TALT-F55 — extends to 5.5 m (18 ft) with 15 steps at 37 cm step distance, 14.9 kg. Anti-pinch finger guards on every step.',
    'Ladders',
    '{"model": "TALT-F55", "ladder_type": "Telescopic (Finger protect)", "steps": 15, "step_distance_cm": 37, "extended_height": "5.5 Mtr (18 Ft)", "weight_kg": 14.9}',
    7306.00, 50, 14.900, 18.00, '{}', true, now() - interval '7 minutes'
  ),
  (
    'c7d8e9f0-0009-4000-8000-000000000009',
    'A-Type Ladder TALT-D44 (4.4 Mtr / 15 Ft)',
    'talt-d44',
    'Double-sided A-type ladder TALT-D44 — 4.4 m (15 ft) working height, 7+7 steps at 30 cm step distance, 16 kg. Self-standing step ladder for two-sided access.',
    'Ladders',
    '{"model": "TALT-D44", "ladder_type": "A-Type", "steps": "7+7", "step_distance_cm": 30, "extended_height": "4.4 Mtr (15 Ft)", "weight_kg": 16}',
    7379.00, 50, 16.000, 18.00, '{}', true, now() - interval '8 minutes'
  ),
  (
    'c7d8e9f0-000a-4000-8000-00000000000a',
    'A-Type Ladder TALT-D56 (5.6 Mtr / 18.5 Ft)',
    'talt-d56',
    'Double-sided A-type ladder TALT-D56 — 5.6 m (18.5 ft) working height, 9+9 steps at 30 cm step distance, 20.7 kg. Self-standing step ladder for two-sided access.',
    'Ladders',
    '{"model": "TALT-D56", "ladder_type": "A-Type", "steps": "9+9", "step_distance_cm": 30, "extended_height": "5.6 Mtr (18.5 Ft)", "weight_kg": 20.7}',
    10134.00, 50, 20.700, 18.00, '{}', true, now() - interval '9 minutes'
  ),
  (
    'c7d8e9f0-000b-4000-8000-00000000000b',
    'A-Type Ladder TALT-D66 (6.6 Mtr / 22 Ft)',
    'talt-d66',
    'Double-sided A-type ladder TALT-D66 — 6.6 m (22 ft) working height, 8+8 steps at 40 cm step distance, 21.2 kg. Self-standing step ladder for two-sided access.',
    'Ladders',
    '{"model": "TALT-D66", "ladder_type": "A-Type", "steps": "8+8", "step_distance_cm": 40, "extended_height": "6.6 Mtr (22 Ft)", "weight_kg": 21.2}',
    10748.00, 50, 21.200, 18.00, '{}', true, now() - interval '10 minutes'
  ),
  (
    'c7d8e9f0-000c-4000-8000-00000000000c',
    'Metal Platform Trolley TMST-150 (150 Kg)',
    'tmst-150',
    'Metal platform trolley TMST-150 — 150 kg capacity, 48*72 platform, 8.0 kg net weight. MS platform with TPR wheels.',
    'Trolleys',
    '{"model": "TMST-150", "capacity_kg": 150, "platform_size": "48*72", "net_weight_kg": 8.0, "material": "MS Platform with TPR"}',
    2358.00, 50, 8.000, 5.00, '{}', true, now() - interval '11 minutes'
  ),
  (
    'c7d8e9f0-000d-4000-8000-00000000000d',
    'Metal Platform Trolley TMST-300 (300 Kg)',
    'tmst-300',
    'Metal platform trolley TMST-300 — 300 kg capacity, 61*91 platform, 13.0 kg net weight. MS platform with TPR wheels.',
    'Trolleys',
    '{"model": "TMST-300", "capacity_kg": 300, "platform_size": "61*91", "net_weight_kg": 13.0, "material": "MS Platform with TPR"}',
    3250.00, 50, 13.000, 5.00, '{}', true, now() - interval '12 minutes'
  ),
  (
    'c7d8e9f0-000e-4000-8000-00000000000e',
    'Metal Platform Trolley TMST-400 (400 Kg)',
    'tmst-400',
    'Metal platform trolley TMST-400 — 400 kg capacity, 60*90 platform, 14.7 kg net weight. MS checkered platform with rubber wheels.',
    'Trolleys',
    '{"model": "TMST-400", "capacity_kg": 400, "platform_size": "60*90", "net_weight_kg": 14.7, "material": "MS checkered With Rubber Wheel"}',
    4564.00, 50, 14.700, 5.00, '{}', true, now() - interval '13 minutes'
  ),
  (
    'c7d8e9f0-000f-4000-8000-00000000000f',
    'Metal Platform Trolley TMST-600 (600 Kg)',
    'tmst-600',
    'Metal platform trolley TMST-600 — 600 kg capacity, 65*110 platform, 21 kg net weight. MS checkered platform with rubber wheels.',
    'Trolleys',
    '{"model": "TMST-600", "capacity_kg": 600, "platform_size": "65*110", "net_weight_kg": 21, "material": "MS checkered With Rubber Wheel"}',
    5332.00, 50, 21.000, 5.00, '{}', true, now() - interval '14 minutes'
  ),
  (
    'c7d8e9f0-0010-4000-8000-000000000010',
    'Plastic Platform Trolley TPT-200 (200 Kg)',
    'tpt-200',
    'Plastic platform trolley TPT-200 — 200 kg capacity, 48*72 platform, 10.2 kg net weight. High-grade HDPE platform trolley.',
    'Trolleys',
    '{"model": "TPT-200", "capacity_kg": 200, "platform_size": "48*72", "net_weight_kg": 10.2, "material": "High-grade HDPE Platform trolley"}',
    2752.00, 50, 10.200, 5.00, '{}', true, now() - interval '15 minutes'
  ),
  (
    'c7d8e9f0-0011-4000-8000-000000000011',
    'Plastic Platform Trolley TPT-400 (400 Kg)',
    'tpt-400',
    'Plastic platform trolley TPT-400 — 400 kg capacity, 60*90 platform, 13.2 kg net weight. High-grade HDPE platform trolley.',
    'Trolleys',
    '{"model": "TPT-400", "capacity_kg": 400, "platform_size": "60*90", "net_weight_kg": 13.2, "material": "High-grade HDPE Platform trolley"}',
    3388.00, 50, 13.200, 5.00, '{}', true, now() - interval '16 minutes'
  ),
  (
    'c7d8e9f0-0012-4000-8000-000000000012',
    'Plastic Platform Trolley TPT-600 (600 Kg)',
    'tpt-600',
    'Plastic platform trolley TPT-600 — 600 kg capacity, 63*105 platform, 16.1 kg net weight. High-grade HDPE platform trolley.',
    'Trolleys',
    '{"model": "TPT-600", "capacity_kg": 600, "platform_size": "63*105", "net_weight_kg": 16.1, "material": "High-grade HDPE Platform trolley"}',
    4647.00, 50, 16.100, 5.00, '{}', true, now() - interval '17 minutes'
  )
on conflict (id) do nothing;

commit;
