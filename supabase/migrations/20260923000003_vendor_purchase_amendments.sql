-- Vendor Purchases gets the same Edit/Amend split invoices just got:
--
--   1. "Edit Purchase Details" -- admin-only, non-financial, no audit trail.
--      vendor_purchases already had a full admin-only UPDATE policy (RLS)
--      with no column-level grant restriction, so a straight client-side
--      update to purchase_kind or the financial totals was technically
--      possible even though no code path ever exercised it. Locking it down
--      here the same way invoice_admin_edit.sql did for invoices: revoke the
--      blanket UPDATE grant, re-grant it only on the four fields the Edit
--      Details form actually exposes. purchase_kind is deliberately excluded
--      -- flipping stock_in_trade <-> office_expense/capital_asset after the
--      fact would silently strand or duplicate the inventory rows that were
--      (or weren't) auto-created at purchase time.
--
--   2. "Amend Purchase" -- admin-only, reason required, immutable audit
--      trail via vendor_purchase_amendments (same shape/discipline as
--      invoice_amendments: insert + read only, admin-only insert, any
--      tenant member can read).
--
-- amend_vendor_purchase is the harder half. Unlike amend_invoice (which can
-- freely delete-and-reinsert every invoice_item, because invoice line items
-- carry no inventory identity of their own), a stock_in_trade vendor_purchase
-- line owns real inventory: a 'product' line's product_ids are one row per
-- physical unit, a 'spare' line's spare_part_id is a running quantity
-- counter. Blowing those away and recreating them would sever or duplicate
-- inventory that may already be sold or partially consumed. So this RPC
-- reconciles instead of replacing: p_items carries an `id` for every
-- existing line being kept (omit it for a genuinely new line), and anything
-- not present in p_items is treated as a removed line. For every quantity
-- reduction or removal touching stock_in_trade inventory, it checks the
-- linked products/spare_parts state first and rejects with a specific
-- message naming the item if the reduction would touch already-sold product
-- units or drive spare_parts.quantity negative -- rather than corrupting
-- inventory silently. Kept units are never rewritten (their serial_imei,
-- purchase_price etc. stay exactly as they are, editable independently on
-- the Products/Spare Parts pages) -- only genuinely new units get created
-- and only genuinely excess (never-sold) units get deleted.

revoke update on public.vendor_purchases from authenticated;
grant update (vendor_id, supplier_invoice_no, purchase_date, notes) on public.vendor_purchases to authenticated;

create table public.vendor_purchase_amendments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  purchase_id uuid not null references public.vendor_purchases (id),
  amended_by uuid not null references auth.users (id),
  amended_at timestamptz not null default now(),
  reason text not null check (btrim(reason) <> ''),
  before_snapshot jsonb not null,
  after_snapshot jsonb not null
);

create index vendor_purchase_amendments_tenant_id_idx on public.vendor_purchase_amendments (tenant_id);
create index vendor_purchase_amendments_purchase_id_idx on public.vendor_purchase_amendments (purchase_id);

alter table public.vendor_purchase_amendments enable row level security;

create policy vendor_purchase_amendments_select on public.vendor_purchase_amendments
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy vendor_purchase_amendments_insert on public.vendor_purchase_amendments
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id));

-- No update or delete policy: the table is immutable by design.

revoke all on public.vendor_purchase_amendments from anon, authenticated;
grant select, insert on public.vendor_purchase_amendments to authenticated;

-- ---------------------------------------------------------------------------
-- amend_vendor_purchase: p_items is a jsonb array of
-- { id (optional -- omit for a new line), item_type, item_name, brand,
--   category, hsn_code, description, ram, storage, condition, unit_price,
--   quantity, gst_rate, serials }. purchase_kind is fixed (read from the
-- existing row, never a parameter here -- see the Edit Details comment
-- above for why).
-- ---------------------------------------------------------------------------
create or replace function public.amend_vendor_purchase(
  p_purchase_id uuid,
  p_reason text,
  p_items jsonb,
  p_round_off boolean,
  p_vendor_actual_total numeric
)
returns public.vendor_purchase_amendments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase public.vendor_purchases%rowtype;
  v_before_snapshot jsonb;
  v_after_snapshot jsonb;
  v_total_taxable_value numeric := 0;
  v_total_gst numeric := 0;
  v_grand_total numeric := 0;
  v_round_off_amount numeric := 0;
  v_item jsonb;
  v_item_id uuid;
  v_item_type text;
  v_quantity numeric;
  v_unit_price numeric;
  v_gst_rate numeric;
  v_taxable_value numeric;
  v_gst_amount numeric;
  v_line_total numeric;
  v_serials text[];
  v_existing_item public.vendor_purchase_items%rowtype;
  v_purchase_item_id uuid;
  v_product_id uuid;
  v_product_ids uuid[];
  v_spare_part_id uuid;
  v_unit_index integer;
  v_seen_ids uuid[] := '{}';
  v_sold_count integer;
  v_available_ids uuid[];
  v_to_delete_count integer;
  v_delete_id uuid;
  v_current_spare_qty numeric;
  v_new_payment_status text;
  v_amendment_id uuid;
  v_result public.vendor_purchase_amendments%rowtype;
  v_old_unit_count integer;
begin
  select * into v_purchase from public.vendor_purchases where id = p_purchase_id;

  if v_purchase.id is null then
    raise exception 'Vendor purchase not found';
  end if;

  if not public.is_tenant_admin(v_purchase.tenant_id) then
    raise exception 'Only a tenant admin can amend a vendor purchase';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to amend a vendor purchase';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Purchase must have at least one line item';
  end if;

  select jsonb_build_object(
    'purchase', to_jsonb(v_purchase),
    'items', coalesce((
      select jsonb_agg(to_jsonb(vpi) order by vpi.created_at)
      from public.vendor_purchase_items vpi
      where vpi.purchase_id = p_purchase_id
    ), '[]'::jsonb)
  ) into v_before_snapshot;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_id := nullif(v_item->>'id', '')::uuid;
    v_item_type := v_item->>'item_type';
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_gst_rate := coalesce((v_item->>'gst_rate')::numeric, 0);
    v_taxable_value := v_quantity * v_unit_price;
    v_gst_amount := round(v_taxable_value * v_gst_rate / 100, 2);
    v_line_total := v_taxable_value + v_gst_amount;

    v_total_taxable_value := v_total_taxable_value + v_taxable_value;
    v_total_gst := v_total_gst + v_gst_amount;

    select array(select jsonb_array_elements_text(coalesce(v_item->'serials', '[]'::jsonb)))
    into v_serials;

    v_spare_part_id := null;

    if v_item_id is not null then
      select * into v_existing_item
      from public.vendor_purchase_items
      where id = v_item_id and purchase_id = p_purchase_id;

      if v_existing_item.id is null then
        raise exception 'Purchase item % not found on this purchase', v_item_id;
      end if;

      if v_existing_item.item_type is distinct from v_item_type then
        raise exception 'Cannot change the type of an existing line ("%"); remove it and add a new line instead',
          v_existing_item.item_name;
      end if;

      v_seen_ids := array_append(v_seen_ids, v_item_id);
      v_product_ids := v_existing_item.product_ids;

      if v_purchase.purchase_kind = 'stock_in_trade' and v_item_type = 'product'
         and v_existing_item.product_ids is not null then
        if v_quantity != trunc(v_quantity) then
          raise exception 'Product line "%" has a fractional quantity (%); products are individually serialized units',
            v_item->>'item_name', v_quantity;
        end if;

        v_old_unit_count := coalesce(array_length(v_existing_item.product_ids, 1), 0);

        select count(*) into v_sold_count
        from public.products
        where id = any(v_existing_item.product_ids) and status = 'sold';

        if v_quantity::integer < v_sold_count then
          raise exception 'Cannot reduce "%" to % unit(s): % of the original % unit(s) are already sold',
            v_item->>'item_name', v_quantity::integer, v_sold_count, v_old_unit_count;
        end if;

        if v_quantity::integer < v_old_unit_count then
          v_to_delete_count := v_old_unit_count - v_quantity::integer;

          select array_agg(id) into v_available_ids
          from public.products
          where id = any(v_existing_item.product_ids) and status is distinct from 'sold';

          for v_delete_id in select unnest(v_available_ids) limit v_to_delete_count
          loop
            delete from public.products where id = v_delete_id;
            v_product_ids := array_remove(v_product_ids, v_delete_id);
          end loop;
        elsif v_quantity::integer > v_old_unit_count then
          for v_unit_index in (v_old_unit_count + 1)..v_quantity::integer
          loop
            insert into public.products (
              tenant_id, name, brand, category, condition, ram, storage, hsn_code, description,
              serial_imei, purchase_price, status, vendor_id, vendor_invoice_no, purchase_date
            )
            values (
              v_purchase.tenant_id, v_item->>'item_name', v_item->>'brand', v_item->>'category', v_item->>'condition',
              v_item->>'ram', v_item->>'storage', v_item->>'hsn_code', v_item->>'description',
              v_serials[v_unit_index - v_old_unit_count], v_unit_price, 'available',
              v_purchase.vendor_id, v_purchase.supplier_invoice_no, v_purchase.purchase_date
            )
            returning id into v_product_id;

            v_product_ids := array_append(v_product_ids, v_product_id);
          end loop;
        end if;
      elsif v_purchase.purchase_kind = 'stock_in_trade' and v_item_type = 'spare'
            and v_existing_item.spare_part_id is not null then
        select quantity into v_current_spare_qty
        from public.spare_parts
        where id = v_existing_item.spare_part_id
        for update;

        if v_current_spare_qty + (v_quantity - v_existing_item.quantity) < 0 then
          raise exception 'Cannot reduce "%" to % unit(s): only % currently in stock (already partially consumed elsewhere)',
            v_item->>'item_name', v_quantity, v_current_spare_qty;
        end if;

        update public.spare_parts
        set quantity = quantity + (v_quantity - v_existing_item.quantity)
        where id = v_existing_item.spare_part_id;

        v_spare_part_id := v_existing_item.spare_part_id;
      end if;

      update public.vendor_purchase_items
      set item_type = v_item_type,
          item_name = v_item->>'item_name',
          brand = v_item->>'brand',
          category = v_item->>'category',
          hsn_code = v_item->>'hsn_code',
          description = v_item->>'description',
          ram = v_item->>'ram',
          storage = v_item->>'storage',
          condition = v_item->>'condition',
          unit_price = v_unit_price,
          quantity = v_quantity,
          gst_rate = v_gst_rate,
          taxable_value = v_taxable_value,
          gst_amount = v_gst_amount,
          total = v_line_total,
          serials = v_serials,
          product_ids = case
            when v_purchase.purchase_kind = 'stock_in_trade' and v_item_type = 'product'
            then v_product_ids else product_ids end,
          spare_part_id = coalesce(v_spare_part_id, spare_part_id)
      where id = v_item_id;
    else
      insert into public.vendor_purchase_items (
        purchase_id, item_type, item_name, brand, category, hsn_code, description,
        ram, storage, condition, unit_price, quantity, gst_rate, taxable_value, gst_amount, total, serials
      )
      values (
        p_purchase_id, v_item_type, v_item->>'item_name', v_item->>'brand', v_item->>'category',
        v_item->>'hsn_code', v_item->>'description', v_item->>'ram', v_item->>'storage', v_item->>'condition',
        v_unit_price, v_quantity, v_gst_rate, v_taxable_value, v_gst_amount, v_line_total, v_serials
      )
      returning id into v_purchase_item_id;

      if v_purchase.purchase_kind = 'stock_in_trade' and v_item_type = 'product' then
        if v_quantity != trunc(v_quantity) then
          raise exception 'Product line "%" has a fractional quantity (%); products are individually serialized units',
            v_item->>'item_name', v_quantity;
        end if;

        v_product_ids := '{}';

        for v_unit_index in 1..v_quantity::integer
        loop
          insert into public.products (
            tenant_id, name, brand, category, condition, ram, storage, hsn_code, description,
            serial_imei, purchase_price, status, vendor_id, vendor_invoice_no, purchase_date
          )
          values (
            v_purchase.tenant_id, v_item->>'item_name', v_item->>'brand', v_item->>'category', v_item->>'condition',
            v_item->>'ram', v_item->>'storage', v_item->>'hsn_code', v_item->>'description',
            v_serials[v_unit_index], v_unit_price, 'available',
            v_purchase.vendor_id, v_purchase.supplier_invoice_no, v_purchase.purchase_date
          )
          returning id into v_product_id;

          v_product_ids := array_append(v_product_ids, v_product_id);
        end loop;

        update public.vendor_purchase_items set product_ids = v_product_ids where id = v_purchase_item_id;
      elsif v_purchase.purchase_kind = 'stock_in_trade' and v_item_type = 'spare' then
        insert into public.spare_parts (
          tenant_id, name, category, quantity, purchase_price, hsn_code, description,
          vendor_id, vendor_invoice_no, purchase_date, tracks_serial, serial_numbers
        )
        values (
          v_purchase.tenant_id, v_item->>'item_name', v_item->>'category', v_quantity, v_unit_price, v_item->>'hsn_code',
          v_item->>'description', v_purchase.vendor_id, v_purchase.supplier_invoice_no, v_purchase.purchase_date,
          coalesce(array_length(v_serials, 1), 0) > 0, v_serials
        )
        returning id into v_spare_part_id;

        update public.vendor_purchase_items set spare_part_id = v_spare_part_id where id = v_purchase_item_id;
      end if;
    end if;
  end loop;

  -- Removed lines: existing items not referenced by id in p_items.
  for v_existing_item in
    select * from public.vendor_purchase_items
    where purchase_id = p_purchase_id
      and (v_seen_ids = '{}' or not (id = any(v_seen_ids)))
  loop
    if v_purchase.purchase_kind = 'stock_in_trade' and v_existing_item.item_type = 'product'
       and v_existing_item.product_ids is not null then
      select count(*) into v_sold_count
      from public.products
      where id = any(v_existing_item.product_ids) and status = 'sold';

      if v_sold_count > 0 then
        raise exception 'Cannot remove "%": % of its % unit(s) are already sold',
          v_existing_item.item_name, v_sold_count, coalesce(array_length(v_existing_item.product_ids, 1), 0);
      end if;

      delete from public.products where id = any(v_existing_item.product_ids);
    elsif v_purchase.purchase_kind = 'stock_in_trade' and v_existing_item.item_type = 'spare'
          and v_existing_item.spare_part_id is not null then
      select quantity into v_current_spare_qty
      from public.spare_parts
      where id = v_existing_item.spare_part_id
      for update;

      if v_current_spare_qty - v_existing_item.quantity < 0 then
        raise exception 'Cannot remove "%": only % of the original % unit(s) remain in stock (already partially consumed elsewhere)',
          v_existing_item.item_name, v_current_spare_qty, v_existing_item.quantity;
      end if;

      update public.spare_parts
      set quantity = quantity - v_existing_item.quantity
      where id = v_existing_item.spare_part_id;
    end if;

    delete from public.vendor_purchase_items where id = v_existing_item.id;
  end loop;

  v_grand_total := v_total_taxable_value + v_total_gst;

  if coalesce(p_round_off, false) then
    if p_vendor_actual_total is null then
      raise exception 'Vendor actual total is required when round off is enabled';
    end if;
    v_round_off_amount := p_vendor_actual_total - v_grand_total;
    v_grand_total := p_vendor_actual_total;
  else
    v_round_off_amount := 0;
  end if;

  v_new_payment_status := case
    when v_purchase.amount_paid >= v_grand_total then 'paid'
    when v_purchase.amount_paid > 0 then 'partial'
    else 'unpaid'
  end;

  update public.vendor_purchases
  set total_taxable_value = v_total_taxable_value,
      total_gst = v_total_gst,
      grand_total = v_grand_total,
      round_off = coalesce(p_round_off, false),
      round_off_amount = v_round_off_amount,
      payment_status = v_new_payment_status
  where id = p_purchase_id;

  select jsonb_build_object(
    'purchase', to_jsonb(vp),
    'items', coalesce((
      select jsonb_agg(to_jsonb(vpi) order by vpi.created_at)
      from public.vendor_purchase_items vpi
      where vpi.purchase_id = p_purchase_id
    ), '[]'::jsonb)
  )
  into v_after_snapshot
  from public.vendor_purchases vp
  where vp.id = p_purchase_id;

  insert into public.vendor_purchase_amendments (
    tenant_id, purchase_id, amended_by, reason, before_snapshot, after_snapshot
  )
  values (
    v_purchase.tenant_id, p_purchase_id, auth.uid(), p_reason, v_before_snapshot, v_after_snapshot
  )
  returning id into v_amendment_id;

  select * into v_result from public.vendor_purchase_amendments where id = v_amendment_id;
  return v_result;
end;
$$;

revoke all on function public.amend_vendor_purchase(uuid, text, jsonb, boolean, numeric) from public;
grant execute on function public.amend_vendor_purchase(uuid, text, jsonb, boolean, numeric) to authenticated;
