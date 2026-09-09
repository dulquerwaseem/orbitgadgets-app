-- Warranty unit for invoice line items. Previously warranty was always in
-- days; products commonly carry warranties in months or years too, and
-- pre-converting "2 years" into "730 days" at entry time would throw away
-- the intent (and drift from calendar reality across leap years). Instead
-- warranty_days keeps storing the original entered number (e.g. 2) paired
-- with warranty_unit (e.g. 'years') -- the true value is the two together,
-- not a pre-converted day count. Only date-math (expiry calculation) needs
-- to account for the unit, done client-side in InvoiceDetail.tsx.

alter table public.invoice_items
  add column warranty_unit text not null default 'days'
    check (warranty_unit in ('days', 'months', 'years'));

-- ---------------------------------------------------------------------------
-- create_invoice: signature unchanged (p_items is still a jsonb array, and
-- warranty_unit is just a new optional key within each item object), so
-- this is a body-only replace -- only the invoice_items insert changes.
-- ---------------------------------------------------------------------------
create or replace function public.create_invoice(
  p_tenant_id uuid,
  p_invoice_series text,
  p_customer_id uuid,
  p_job_sheet_id uuid,
  p_customer_gst text,
  p_eway_bill text,
  p_discount numeric,
  p_labor_charge numeric,
  p_labor_sac_code text,
  p_payment_status text,
  p_amount_paid numeric,
  p_items jsonb,
  p_round_off boolean default false
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_number text;
  v_invoice_id uuid;
  v_items_total numeric := 0;
  v_taxable_value numeric;
  v_cgst_amount numeric;
  v_sgst_amount numeric;
  v_final_price numeric;
  v_round_off_amount numeric := 0;
  v_item jsonb;
  v_quantity numeric;
  v_unit_price numeric;
  v_total_price numeric;
  v_product_id uuid;
  v_spare_part_id uuid;
  v_item_type text;
  v_spare_qty numeric;
  v_updated_product_id uuid;
  v_result public.invoices%rowtype;
begin
  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  if p_invoice_series not in ('gst', 'non_gst') then
    raise exception 'Invalid invoice series: %', p_invoice_series;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Invoice must have at least one line item';
  end if;

  if p_customer_id is not null then
    perform 1 from public.customers where id = p_customer_id and tenant_id = p_tenant_id;
    if not found then
      raise exception 'Customer not found for this tenant';
    end if;
  end if;

  if p_job_sheet_id is not null then
    perform 1 from public.job_sheets where id = p_job_sheet_id and tenant_id = p_tenant_id;
    if not found then
      raise exception 'Job sheet not found for this tenant';
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    if v_item->>'item_type' not in ('product', 'spare', 'service', 'custom') then
      raise exception 'Invalid item_type: %', v_item->>'item_type';
    end if;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_items_total := v_items_total + (v_quantity * v_unit_price);
  end loop;

  v_taxable_value := v_items_total + coalesce(p_labor_charge, 0) - coalesce(p_discount, 0);

  if p_invoice_series = 'gst' then
    v_cgst_amount := round(v_taxable_value * 0.09, 2);
    v_sgst_amount := round(v_taxable_value * 0.09, 2);
    v_final_price := v_taxable_value + v_cgst_amount + v_sgst_amount;
  else
    v_cgst_amount := 0;
    v_sgst_amount := 0;
    v_final_price := v_taxable_value;
  end if;

  if coalesce(p_round_off, false) then
    v_round_off_amount := round(v_final_price) - v_final_price;
    v_final_price := round(v_final_price);
  else
    v_round_off_amount := 0;
  end if;

  v_invoice_number := public.next_invoice_number(p_tenant_id, p_invoice_series);

  insert into public.invoices (
    tenant_id, invoice_number, invoice_series, customer_id, job_sheet_id,
    customer_gst, eway_bill, discount, taxable_value, cgst_amount, sgst_amount,
    final_price, labor_charge, labor_sac_code, payment_status, amount_paid,
    round_off, round_off_amount
  )
  values (
    p_tenant_id, v_invoice_number, p_invoice_series, p_customer_id, p_job_sheet_id,
    p_customer_gst, p_eway_bill, coalesce(p_discount, 0), v_taxable_value, v_cgst_amount, v_sgst_amount,
    v_final_price, coalesce(p_labor_charge, 0), p_labor_sac_code,
    coalesce(p_payment_status, 'unpaid'), coalesce(p_amount_paid, 0),
    coalesce(p_round_off, false), v_round_off_amount
  )
  returning id into v_invoice_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_type := v_item->>'item_type';
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_spare_part_id := nullif(v_item->>'spare_part_id', '')::uuid;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_total_price := v_quantity * v_unit_price;

    insert into public.invoice_items (
      invoice_id, item_type, product_id, spare_part_id, item_name, description,
      hsn_code, serial_imei, ram, storage, quantity, unit_price, cost_price, total_price,
      warranty_days, warranty_unit, warranty_notes
    )
    values (
      v_invoice_id, v_item_type, v_product_id, v_spare_part_id,
      v_item->>'item_name', v_item->>'description', v_item->>'hsn_code',
      v_item->>'serial_imei', v_item->>'ram', v_item->>'storage',
      v_quantity, v_unit_price,
      nullif(v_item->>'cost_price', '')::numeric, v_total_price,
      nullif(v_item->>'warranty_days', '')::integer,
      coalesce(nullif(v_item->>'warranty_unit', ''), 'days'),
      v_item->>'warranty_notes'
    );

    -- Manually entered product lines (no product_id) have nothing to mark sold.
    if v_item_type = 'product' and v_product_id is not null then
      update public.products
      set status = 'sold'
      where id = v_product_id
        and tenant_id = p_tenant_id
        and coalesce(status, '') is distinct from 'sold'
      returning id into v_updated_product_id;

      if v_updated_product_id is null then
        raise exception 'Product % is unavailable or already sold', v_product_id;
      end if;
    elsif v_item_type = 'spare' and v_spare_part_id is not null then
      select quantity into v_spare_qty
      from public.spare_parts
      where id = v_spare_part_id and tenant_id = p_tenant_id
      for update;

      if v_spare_qty is null then
        raise exception 'Spare part % not found for this tenant', v_spare_part_id;
      end if;

      if v_spare_qty < v_quantity then
        raise exception 'Insufficient stock for spare part % (have %, need %)', v_spare_part_id, v_spare_qty, v_quantity;
      end if;

      update public.spare_parts set quantity = quantity - v_quantity where id = v_spare_part_id;
    end if;
  end loop;

  select * into v_result from public.invoices where id = v_invoice_id;
  return v_result;
end;
$$;

revoke all on function public.create_invoice(
  uuid, text, uuid, uuid, text, text, numeric, numeric, text, text, numeric, jsonb, boolean
) from public;
grant execute on function public.create_invoice(
  uuid, text, uuid, uuid, text, text, numeric, numeric, text, text, numeric, jsonb, boolean
) to authenticated;

-- ---------------------------------------------------------------------------
-- convert_invoice_to_gst: signature unchanged (p_invoice_id uuid only), so
-- this is a body-only replace -- warranty_unit is just carried across in the
-- invoice_items copy alongside warranty_days, same treatment as every other
-- column that just needs to survive the clone.
-- ---------------------------------------------------------------------------
create or replace function public.convert_invoice_to_gst(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.invoices%rowtype;
  v_new_id uuid;
  v_new_number text;
  v_cgst_amount numeric;
  v_sgst_amount numeric;
  v_final_price numeric;
  v_round_off_amount numeric := 0;
  v_result public.invoices%rowtype;
begin
  select * into v_source from public.invoices where id = p_invoice_id;

  if v_source.id is null then
    raise exception 'Invoice not found';
  end if;

  if not public.is_tenant_member(v_source.tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  if v_source.invoice_series = 'gst' then
    raise exception 'Invoice is already a GST invoice';
  end if;

  if v_source.superseded then
    raise exception 'Invoice has already been converted';
  end if;

  if v_source.void then
    raise exception 'Cannot convert a voided invoice';
  end if;

  v_cgst_amount := round(v_source.taxable_value * 0.09, 2);
  v_sgst_amount := round(v_source.taxable_value * 0.09, 2);
  v_final_price := v_source.taxable_value + v_cgst_amount + v_sgst_amount;

  if v_source.round_off then
    v_round_off_amount := round(v_final_price) - v_final_price;
    v_final_price := round(v_final_price);
  else
    v_round_off_amount := 0;
  end if;

  v_new_number := public.next_invoice_number(v_source.tenant_id, 'gst');

  insert into public.invoices (
    tenant_id, invoice_number, invoice_series, customer_id, job_sheet_id,
    customer_gst, eway_bill, discount, taxable_value, cgst_amount, sgst_amount,
    final_price, labor_charge, labor_sac_code,
    status, payment_status, amount_paid, converted_from_invoice_id,
    round_off, round_off_amount
  )
  values (
    v_source.tenant_id, v_new_number, 'gst', v_source.customer_id, v_source.job_sheet_id,
    v_source.customer_gst, v_source.eway_bill, v_source.discount, v_source.taxable_value,
    v_cgst_amount, v_sgst_amount, v_final_price,
    v_source.labor_charge, v_source.labor_sac_code,
    v_source.status, v_source.payment_status, v_source.amount_paid, v_source.id,
    v_source.round_off, v_round_off_amount
  )
  returning id into v_new_id;

  insert into public.invoice_items (
    invoice_id, item_type, product_id, spare_part_id, item_name, description,
    hsn_code, serial_imei, ram, storage, quantity, unit_price, cost_price, total_price,
    warranty_days, warranty_unit, warranty_notes
  )
  select
    v_new_id, item_type, product_id, spare_part_id, item_name, description,
    hsn_code, serial_imei, ram, storage, quantity, unit_price, cost_price, total_price,
    warranty_days, warranty_unit, warranty_notes
  from public.invoice_items
  where invoice_id = v_source.id;

  update public.invoices set superseded = true where id = v_source.id;

  select * into v_result from public.invoices where id = v_new_id;
  return v_result;
end;
$$;

revoke all on function public.convert_invoice_to_gst(uuid) from public;
grant execute on function public.convert_invoice_to_gst(uuid) to authenticated;
