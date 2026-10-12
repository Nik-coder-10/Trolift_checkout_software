-- Trolift Solutions — 0032 bulk import persists HSN
--
-- The product CSV carries an optional trailing `hsn` column and the
-- application validator accepts it, but import_products() (0020)
-- hardcodes its column list: without this change an imported HSN
-- would validate cleanly and then be silently discarded at apply
-- time. This replacement is identical to 0020 plus hsn_code on both
-- the UPDATE and INSERT paths. No backfill, no constraint, no data
-- rewrite. Forward migration only; earlier files untouched.
--
-- HSN omission policy (protects RPC callers that predate HSN — between
-- deploying this migration and rolling out the app version that sends
-- hsn_code, old in-flight callers must not erase stored HSNs):
--   * INSERT, hsn_code absent or blank -> NULL.
--   * UPDATE, hsn_code KEY ABSENT      -> existing HSN preserved (the
--     exact 0020 behavior: `?` tests key presence, so a caller that
--     never learned about hsn_code cannot wipe it).
--   * UPDATE, hsn_code present blank   -> HSN cleared (explicit intent;
--     the current CSV import sends "" for a blank hsn cell).
--   * UPDATE, hsn_code present valid   -> supplied HSN persisted.

-- p_rows: [{name, slug, description, category, price, stock_quantity,
--   low_stock_threshold, is_active, gst_rate, weight_kg, hsn_code}]
-- with NUMERIC columns as decimal strings and booleans as JSON
-- booleans. Slugs are matched normalized (lowercase); existing slugs
-- update in place.
create or replace function public.import_products(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_slug text;
  v_existing uuid;
  v_inserted integer := 0;
  v_updated integer := 0;
begin
  if not (public.is_admin() or auth.uid() is null) then
    raise exception 'not authorized' using errcode = 'raise_exception';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a JSON array' using errcode = 'raise_exception';
  end if;

  for v_item in select * from jsonb_array_elements(p_rows) loop
    v_slug := lower(trim(v_item ->> 'slug'));
    if v_slug is null or v_slug = '' then
      raise exception 'row is missing slug' using errcode = 'raise_exception';
    end if;

    select id into v_existing from public.products where slug = v_slug;
    if v_existing is not null then
      update public.products set
        name = v_item ->> 'name',
        description = coalesce(nullif(v_item ->> 'description', ''), description),
        category = v_item ->> 'category',
        price = (v_item ->> 'price')::numeric,
        stock_quantity = (v_item ->> 'stock_quantity')::integer,
        low_stock_threshold = (v_item ->> 'low_stock_threshold')::integer,
        is_active = (v_item ->> 'is_active')::boolean,
        gst_rate = nullif(v_item ->> 'gst_rate', '')::numeric,
        weight_kg = nullif(v_item ->> 'weight_kg', '')::numeric,
        -- Key-absent must PRESERVE (0020 parity); only an explicitly
        -- supplied hsn_code — including "" — changes the stored value.
        hsn_code = case
          when v_item ? 'hsn_code' then nullif(v_item ->> 'hsn_code', '')
          else hsn_code
        end,
        updated_at = now()
      where id = v_existing;
      v_updated := v_updated + 1;
    else
      insert into public.products (
        name, slug, description, category, price, stock_quantity,
        low_stock_threshold, is_active, gst_rate, weight_kg, hsn_code
      )
      values (
        v_item ->> 'name',
        v_slug,
        coalesce(nullif(v_item ->> 'description', ''), ''),
        v_item ->> 'category',
        (v_item ->> 'price')::numeric,
        coalesce((v_item ->> 'stock_quantity'), '0')::integer,
        coalesce((v_item ->> 'low_stock_threshold'), '5')::integer,
        coalesce((v_item ->> 'is_active'), 'true')::boolean,
        nullif(v_item ->> 'gst_rate', '')::numeric,
        nullif(v_item ->> 'weight_kg', '')::numeric,
        nullif(v_item ->> 'hsn_code', '')
      );
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$$;

revoke all on function public.import_products(jsonb) from public;
grant execute on function public.import_products(jsonb) to authenticated, service_role;
