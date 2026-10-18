-- 0040_finger_protect_images.sql
-- ─── Product media: finger-protect telescopic ladders ───────────────
-- Both finger-protect SKUs share one photo set (the boxes and the
-- erected ladder are identical across the range; only the size label
-- differs, which the gallery captions already carry):
--
--   • talt-fp-01.png — sealed TROLIFT boxes staged at the warehouse
--   • talt-fp-02.png — erected ladder anti-pinch guard close-up
--
-- Mirrors the static fallback in lib/catalog/products.ts and
-- supabase/seed/seed.sql. Idempotent (re-run sets the same values).

update public.products
   set images = array[
         '/images/products/talt-fp-01.png',
         '/images/products/talt-fp-02.png'
       ],
       updated_at = now()
 where slug in ('talt-f44', 'talt-f55')
   and images <> array[
         '/images/products/talt-fp-01.png',
         '/images/products/talt-fp-02.png'
       ];

do $$
declare
  missing int;
begin
  select count(*) into missing
  from public.products
  where slug in ('talt-f44', 'talt-f55')
    and images <> array[
          '/images/products/talt-fp-01.png',
          '/images/products/talt-fp-02.png'
        ];
  if missing > 0 then
    raise exception '0040: % finger-protect rows did not get images', missing;
  end if;
end $$;
