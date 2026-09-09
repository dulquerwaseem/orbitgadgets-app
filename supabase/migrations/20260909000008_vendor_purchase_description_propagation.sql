-- Bug: create_vendor_purchase's auto-linking logic (the part that creates
-- products/spare_parts rows for stock_in_trade lines) never carried the
-- line item's description across, even though vendor_purchase_items itself
-- stores it correctly. Staff-typed spec details were silently dropped the
-- moment the purchase was saved, and never appeared on the Products/Spare
-- Parts pages. Signature unchanged -- body-only replace, just adding
-- description to both insert statements.

create or replace function public.create_vendor_purchase(
  p_tenant_id uuid,
  p_vendor_id uuid,
  p_supplier_invoice_no text,
  p_purchase_date date,
  p_purchase_kind text,
  p_notes text,
  p_items jsonb,
  p_payment_status text default 'unpaid',
  p_amount_paid numeric default 0,
  p_round_off boolean default false,
  p_vendor_actual_total numeric default null
)
returns public.vendor_purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_number text;
  v_purchase_id uuid;
  v_total_taxable_value numeric := 0;
  v_total_gst numeric := 0;
  v_grand_total numeric := 0;
  v_round_off_amount numeric := 0;
  v_item jsonb;
  v_item_type text;
  v_quantity numeric;
  v_unit_price numeric;
  v_gst_rate numeric;
  v_taxable_value numeric;
  v_gst_amount numeric;
  v_line_total numeric;
  v_serials text[];
  v_purchase_item_id uuid;
  v_product_id uuid;
  v_product_ids uuid[];
  v_spare_part_id uuid;
  v_unit_index integer;
  v_result public.vendor_purchases%rowtype;
begin
  if not public.is_tenant_admin(p_tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  perform 1 from public.vendors where id = p_vendor_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Vendor not found for this tenant';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Purchase must have at least one line item';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_gst_rate := coalesce((v_item->>'gst_rate')::numeric, 0);
    v_taxable_value := v_quantity * v_unit_price;
    v_gst_amount := round(v_taxable_value * v_gst_rate / 100, 2);

    v_total_taxable_value := v_total_taxable_value + v_taxable_value;
    v_total_gst := v_total_gst + v_gst_amount;
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

  v_purchase_number := public.next_vendor_purchase_number(p_tenant_id);

  insert into public.vendor_purchases (
    tenant_id, purchase_number, vendor_id, supplier_invoice_no, purchase_date,
    purchase_kind, total_taxable_value, total_gst, grand_total, notes,
    payment_status, amount_paid, round_off, round_off_amount
  )
  values (
    p_tenant_id, v_purchase_number, p_vendor_id, p_supplier_invoice_no, coalesce(p_purchase_date, current_date),
    p_purchase_kind, v_total_taxable_value, v_total_gst, v_grand_total, p_notes,
    coalesce(p_payment_status, 'unpaid'), coalesce(p_amount_paid, 0),
    coalesce(p_round_off, false), v_round_off_amount
  )
  returning id into v_purchase_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_type := v_item->>'item_type';
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_gst_rate := coalesce((v_item->>'gst_rate')::numeric, 0);
    v_taxable_value := v_quantity * v_unit_price;
    v_gst_amount := round(v_taxable_value * v_gst_rate / 100, 2);
    v_line_total := v_taxable_value + v_gst_amount;

    select array(select jsonb_array_elements_text(coalesce(v_item->'serials', '[]'::jsonb)))
    into v_serials;

    insert into public.vendor_purchase_items (
      purchase_id, item_type, item_name, brand, category, hsn_code, description,
      ram, storage, condition, unit_price, quantity, gst_rate, taxable_value, gst_amount, total, serials
    )
    values (
      v_purchase_id, v_item_type, v_item->>'item_name', v_item->>'brand', v_item->>'category',
      v_item->>'hsn_code', v_item->>'description', v_item->>'ram', v_item->>'storage', v_item->>'condition',
      v_unit_price, v_quantity, v_gst_rate, v_taxable_value, v_gst_amount, v_line_total, v_serials
    )
    returning id into v_purchase_item_id;

    if p_purchase_kind = 'stock_in_trade' and v_item_type = 'product' then
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
          p_tenant_id, v_item->>'item_name', v_item->>'brand', v_item->>'category', v_item->>'condition',
          v_item->>'ram', v_item->>'storage', v_item->>'hsn_code', v_item->>'description',
          v_serials[v_unit_index], v_unit_price, 'available', p_vendor_id, p_supplier_invoice_no, p_purchase_date
        )
        returning id into v_product_id;

        v_product_ids := array_append(v_product_ids, v_product_id);
      end loop;

      update public.vendor_purchase_items
      set product_ids = v_product_ids
      where id = v_purchase_item_id;
    elsif p_purchase_kind = 'stock_in_trade' and v_item_type = 'spare' then
      insert into public.spare_parts (
        tenant_id, name, category, quantity, purchase_price, hsn_code, description,
        vendor_id, vendor_invoice_no, purchase_date, tracks_serial, serial_numbers
      )
      values (
        p_tenant_id, v_item->>'item_name', v_item->>'category', v_quantity, v_unit_price, v_item->>'hsn_code',
        v_item->>'description',
        p_vendor_id, p_supplier_invoice_no, p_purchase_date,
        coalesce(array_length(v_serials, 1), 0) > 0, v_serials
      )
      returning id into v_spare_part_id;

      update public.vendor_purchase_items
      set spare_part_id = v_spare_part_id
      where id = v_purchase_item_id;
    end if;
  end loop;

  select * into v_result from public.vendor_purchases where id = v_purchase_id;
  return v_result;
end;
$$;
