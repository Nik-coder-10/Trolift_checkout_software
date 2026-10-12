-- =====================================================================
-- import_products() HSN omission drill (migration 0032)
-- =====================================================================
-- Real-PostgreSQL behavioural test for the four HSN cases. Run against
-- a DISPOSABLE database with the FULL migration chain applied through
-- 0032 — never against dev, staging or production:
--
--   psql "$DISPOSABLE_URL" -v ON_ERROR_STOP=1 \
--     -f scripts/db-drills/import-products-hsn.sql
--
-- Every assertion raises on mismatch, so ON_ERROR_STOP makes the run
-- exit non-zero on any regression. Nothing is committed: the whole
-- drill runs inside one transaction and rolls back at the end.
--
-- Cases (the policy documented at the top of 0032):
--   1. INSERT, hsn_code key ABSENT   -> NULL
--   2. INSERT, hsn_code present blank-> NULL
--   3. UPDATE, hsn_code key ABSENT   -> existing HSN PRESERVED
--   4. UPDATE, hsn_code present blank-> HSN cleared
--   5. UPDATE, hsn_code present valid-> supplied HSN persisted
-- =====================================================================

begin;

-- ── Fixtures: synthetic, namespaced "DRDRILL", valid HSNs ───────────
-- HSN CHECK constraints are respected, never disabled.
insert into public.products
  (name, slug, category, price, low_stock_threshold, hsn_code)
values
  ('DRDRILL Keep',  'drdrill-hsn-keep',  'Drill', 100.00, 5, '87168010'),
  ('DRDRILL Clear', 'drdrill-hsn-clear', 'Drill', 100.00, 5, '84271000');

-- ── Case 1: INSERT with no hsn_code key -> NULL ─────────────────────
do $$
declare
  v_res jsonb;
  v_hsn text;
begin
  v_res := public.import_products(jsonb_build_array(jsonb_build_object(
    'name', 'DRDRILL Insert Absent', 'slug', 'drdrill-insert-absent',
    'description', '', 'category', 'Drill', 'price', '100.00',
    'stock_quantity', '0', 'low_stock_threshold', '5',
    'is_active', 'true', 'gst_rate', '', 'weight_kg', ''
  )));
  if (v_res ->> 'inserted')::int <> 1 then
    raise exception 'case1: expected inserted=1, got %', v_res;
  end if;
  select hsn_code into v_hsn
    from public.products where slug = 'drdrill-insert-absent';
  if v_hsn is not null then
    raise exception 'case1: absent key must INSERT NULL, got %', v_hsn;
  end if;
end $$;

-- ── Case 2: INSERT with hsn_code present but blank -> NULL ──────────
do $$
declare
  v_res jsonb;
  v_hsn text;
begin
  v_res := public.import_products(jsonb_build_array(jsonb_build_object(
    'name', 'DRDRILL Insert Blank', 'slug', 'drdrill-insert-blank',
    'description', '', 'category', 'Drill', 'price', '100.00',
    'stock_quantity', '0', 'low_stock_threshold', '5',
    'is_active', 'true', 'gst_rate', '', 'weight_kg', '', 'hsn_code', ''
  )));
  if (v_res ->> 'inserted')::int <> 1 then
    raise exception 'case2: expected inserted=1, got %', v_res;
  end if;
  select hsn_code into v_hsn
    from public.products where slug = 'drdrill-insert-blank';
  if v_hsn is not null then
    raise exception 'case2: blank key must INSERT NULL, got %', v_hsn;
  end if;
end $$;

-- ── Case 3: UPDATE with no hsn_code key -> PRESERVE existing HSN ────
do $$
declare
  v_res jsonb;
  v_hsn text;
begin
  v_res := public.import_products(jsonb_build_array(jsonb_build_object(
    'name', 'DRDRILL Keep Renamed', 'slug', 'drdrill-hsn-keep',
    'description', '', 'category', 'Drill', 'price', '100.00',
    'stock_quantity', '0', 'low_stock_threshold', '5',
    'is_active', 'true', 'gst_rate', '', 'weight_kg', ''
  )));
  if (v_res ->> 'updated')::int <> 1 then
    raise exception 'case3: expected updated=1, got %', v_res;
  end if;
  select hsn_code into v_hsn
    from public.products where slug = 'drdrill-hsn-keep';
  if v_hsn is distinct from '87168010' then
    raise exception 'case3: absent key must PRESERVE HSN, got %',
      coalesce(v_hsn, '<null>');
  end if;
end $$;

-- ── Case 4: UPDATE with hsn_code present blank -> CLEAR the HSN ─────
do $$
declare
  v_res jsonb;
  v_hsn text;
begin
  v_res := public.import_products(jsonb_build_array(jsonb_build_object(
    'name', 'DRDRILL Keep', 'slug', 'drdrill-hsn-keep',
    'description', '', 'category', 'Drill', 'price', '100.00',
    'stock_quantity', '0', 'low_stock_threshold', '5',
    'is_active', 'true', 'gst_rate', '', 'weight_kg', '', 'hsn_code', ''
  )));
  if (v_res ->> 'updated')::int <> 1 then
    raise exception 'case4: expected updated=1, got %', v_res;
  end if;
  select hsn_code into v_hsn
    from public.products where slug = 'drdrill-hsn-keep';
  if v_hsn is not null then
    raise exception 'case4: blank key must CLEAR HSN, got %', v_hsn;
  end if;
end $$;

-- ── Case 5: UPDATE with a valid HSN -> PERSIST it ───────────────────
do $$
declare
  v_res jsonb;
  v_hsn text;
begin
  v_res := public.import_products(jsonb_build_array(jsonb_build_object(
    'name', 'DRDRILL Clear', 'slug', 'drdrill-hsn-clear',
    'description', '', 'category', 'Drill', 'price', '100.00',
    'stock_quantity', '0', 'low_stock_threshold', '5',
    'is_active', 'true', 'gst_rate', '', 'weight_kg', '', 'hsn_code', '8708'
  )));
  if (v_res ->> 'updated')::int <> 1 then
    raise exception 'case5: expected updated=1, got %', v_res;
  end if;
  select hsn_code into v_hsn
    from public.products where slug = 'drdrill-hsn-clear';
  if v_hsn is distinct from '8708' then
    raise exception 'case5: valid HSN must persist, got %',
      coalesce(v_hsn, '<null>');
  end if;
end $$;

-- ── Mixed batch: counters stay exact across insert + update ─────────
-- One absent-key insert and one valid-HSN update in a single call.
do $$
declare
  v_res jsonb;
  v_hsn text;
begin
  v_res := public.import_products(jsonb_build_array(
    jsonb_build_object(
      'name', 'DRDRILL Batch Insert', 'slug', 'drdrill-batch-insert',
      'description', '', 'category', 'Drill', 'price', '100.00',
      'stock_quantity', '0', 'low_stock_threshold', '5',
      'is_active', 'true', 'gst_rate', '', 'weight_kg', ''
    ),
    jsonb_build_object(
      'name', 'DRDRILL Keep Again', 'slug', 'drdrill-hsn-keep',
      'description', '', 'category', 'Drill', 'price', '100.00',
      'stock_quantity', '0', 'low_stock_threshold', '5',
      'is_active', 'true', 'gst_rate', '', 'weight_kg', '', 'hsn_code', '871680'
    )
  ));
  if (v_res ->> 'inserted')::int <> 1 or (v_res ->> 'updated')::int <> 1 then
    raise exception 'mixed: expected inserted=1, updated=1, got %', v_res;
  end if;
  select hsn_code into v_hsn
    from public.products where slug = 'drdrill-hsn-keep';
  if v_hsn is distinct from '871680' then
    raise exception 'mixed: valid HSN must persist, got %',
      coalesce(v_hsn, '<null>');
  end if;
end $$;

-- ── Keyless caller (auth.uid() null) is authorized ──────────────────
do $$
begin
  -- Already exercised above (every call ran with auth.uid() null); assert
  -- the guard did not raise for the keyless path.
  perform public.import_products('[]'::jsonb);
end $$;

select 'import-products HSN drill: all cases passed' as result;

rollback;
