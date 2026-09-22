-- "Prices include GST" entry mode: lets staff type a single tax-inclusive
-- figure (e.g. a customer-quoted "₹999 all-in" price) and have the GST split
-- back-calculated, instead of typing a pre-tax figure and having GST added on
-- top. Fixes the tax-inclusive entry mistake at the source (Amend Invoice was
-- already able to fix it after the fact; this prevents needing to).
--
-- The back-calculation is the exact formula already proven correct during the
-- historical data migration (migration/migration-plan.md, "invoices" section):
-- validated three independent ways there, including cross-referencing the old
-- system's ledger_entries "GST Payable" account to the penny on every
-- tax-inclusive row.
--
-- tax_inclusive_entry is a record of *how the invoice was entered*, for
-- transparency/audit only -- once taxable_value/cgst_amount/sgst_amount/
-- final_price are computed and stored, nothing downstream (printing,
-- payments, credit notes, amendments) treats a tax-inclusive invoice any
-- differently from one entered pre-tax.

alter table public.invoices
  add column tax_inclusive_entry boolean not null default false;

-- ---------------------------------------------------------------------------
-- compute_invoice_totals: adding p_tax_inclusive is a genuine signature
-- change (a new argument), same treatment as p_round_off's addition to
-- create_invoice -- drop the old 5-arg version, create the 6-arg one.
--
-- When tax-inclusive, the entered combined amount (items + labor - discount)
-- is treated as the final figure and the split is derived backwards from it,
-- rather than treating it as a pre-tax figure and adding GST on top. This
-- preserves the exact entered total (no rounding drift from re-deriving it),
-- which is why final_price is assigned directly from the combined amount
-- rather than reconstructed as taxable_value + cgst + sgst.
-- ---------------------------------------------------------------------------
drop function if exists public.compute_invoice_totals(numeric, numeric, numeric, text, boolean);

create or replace function public.compute_invoice_totals(
  p_items_total numeric,
  p_discount numeric,
  p_labor_charge numeric,
  p_invoice_series text,
  p_round_off boolean,
  p_tax_inclusive boolean default false,
  out taxable_value numeric,
  out cgst_amount numeric,
  out sgst_amount numeric,
  out final_price numeric,
  out round_off_amount numeric
)
language plpgsql
as $$
declare
  v_combined numeric;
begin
  if coalesce(p_tax_inclusive, false) and p_invoice_series <> 'gst' then
    raise exception 'Tax-inclusive entry only applies to GST invoices';
  end if;

  v_combined := coalesce(p_items_total, 0) + coalesce(p_labor_charge, 0) - coalesce(p_discount, 0);

  if coalesce(p_tax_inclusive, false) then
    final_price := v_combined;
    taxable_value := round(final_price / 1.18, 2);
    cgst_amount := round((final_price - taxable_value) / 2, 2);
    sgst_amount := cgst_amount;
  else
    taxable_value := v_combined;

    if p_invoice_series = 'gst' then
      cgst_amount := round(taxable_value * 0.09, 2);
      sgst_amount := round(taxable_value * 0.09, 2);
      final_price := taxable_value + cgst_amount + sgst_amount;
    else
      cgst_amount := 0;
      sgst_amount := 0;
      final_price := taxable_value;
    end if;
  end if;

  if coalesce(p_round_off, false) then
    round_off_amount := round(final_price) - final_price;
    final_price := round(final_price);
  else
    round_off_amount := 0;
  end if;
end;
$$;

revoke all on function public.compute_invoice_totals(numeric, numeric, numeric, text, boolean, boolean) from public;
grant execute on function public.compute_invoice_totals(numeric, numeric, numeric, text, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- create_invoice: adding p_tax_inclusive is a genuine signature change, same
-- treatment as p_round_off's addition -- drop the old 13-arg version, create
-- the 14-arg one. Body otherwise unchanged except passing the new flag
-- through to compute_invoice_totals and storing it on the invoice row.
-- ---------------------------------------------------------------------------
drop function if exists public.create_invoice(
  uuid, text, uuid, uuid, text, text, numeric, numeric, text, text, numeric, jsonb, boolean
);

create function public.create_invoice(
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
  p_round_off boolean default false,
  p_tax_inclusive boolean default false
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
  v_totals record;
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

  select * into v_totals from public.compute_invoice_totals(
    v_items_total, p_discount, p_labor_charge, p_invoice_series, p_round_off, p_tax_inclusive
  );

  v_invoice_number := public.next_invoice_number(p_tenant_id, p_invoice_series);

  insert into public.invoices (
    tenant_id, invoice_number, invoice_series, customer_id, job_sheet_id,
    customer_gst, eway_bill, discount, taxable_value, cgst_amount, sgst_amount,
    final_price, labor_charge, labor_sac_code, payment_status, amount_paid,
    round_off, round_off_amount, tax_inclusive_entry
  )
  values (
    p_tenant_id, v_invoice_number, p_invoice_series, p_customer_id, p_job_sheet_id,
    p_customer_gst, p_eway_bill, coalesce(p_discount, 0), v_totals.taxable_value,
    v_totals.cgst_amount, v_totals.sgst_amount, v_totals.final_price,
    coalesce(p_labor_charge, 0), p_labor_sac_code,
    coalesce(p_payment_status, 'unpaid'), coalesce(p_amount_paid, 0),
    coalesce(p_round_off, false), v_totals.round_off_amount, coalesce(p_tax_inclusive, false)
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
  uuid, text, uuid, uuid, text, text, numeric, numeric, text, text, numeric, jsonb, boolean, boolean
) from public;
grant execute on function public.create_invoice(
  uuid, text, uuid, uuid, text, text, numeric, numeric, text, text, numeric, jsonb, boolean, boolean
) to authenticated;

-- ---------------------------------------------------------------------------
-- amend_invoice: adding p_tax_inclusive is a genuine signature change --
-- drop the old 7-arg version, create the 8-arg one. Body otherwise unchanged
-- except passing the new flag through to compute_invoice_totals and updating
-- it on the invoice row (this is exactly the tool for fixing a past
-- tax-inclusive entry mistake, so it needs to be able to flip the flag on an
-- already-issued invoice, same as it already flips every other total).
-- ---------------------------------------------------------------------------
drop function if exists public.amend_invoice(uuid, text, jsonb, numeric, numeric, text, boolean);

create function public.amend_invoice(
  p_invoice_id uuid,
  p_reason text,
  p_items jsonb,
  p_discount numeric,
  p_labor_charge numeric,
  p_labor_sac_code text,
  p_round_off boolean,
  p_tax_inclusive boolean default false
)
returns public.invoice_amendments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_before_snapshot jsonb;
  v_after_snapshot jsonb;
  v_items_total numeric := 0;
  v_totals record;
  v_item jsonb;
  v_quantity numeric;
  v_unit_price numeric;
  v_total_price numeric;
  v_product_id uuid;
  v_spare_part_id uuid;
  v_item_type text;
  v_new_payment_status text;
  v_amendment_id uuid;
  v_result public.invoice_amendments%rowtype;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;

  if v_invoice.id is null then
    raise exception 'Invoice not found';
  end if;

  if not public.is_tenant_admin(v_invoice.tenant_id) then
    raise exception 'Only a tenant admin can amend an invoice';
  end if;

  if v_invoice.void then
    raise exception 'Cannot amend a voided invoice';
  end if;

  if v_invoice.superseded then
    raise exception 'Cannot amend a superseded invoice';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to amend an invoice';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Invoice must have at least one line item';
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

  select * into v_totals from public.compute_invoice_totals(
    v_items_total, p_discount, p_labor_charge, v_invoice.invoice_series, p_round_off, p_tax_inclusive
  );

  select jsonb_build_object(
    'invoice', to_jsonb(v_invoice),
    'items', coalesce((
      select jsonb_agg(to_jsonb(ii) order by ii.created_at)
      from public.invoice_items ii
      where ii.invoice_id = p_invoice_id
    ), '[]'::jsonb)
  ) into v_before_snapshot;

  v_new_payment_status := case
    when v_invoice.amount_paid >= v_totals.final_price then 'paid'
    when v_invoice.amount_paid > 0 then 'partial'
    else 'unpaid'
  end;

  update public.invoices
  set discount = coalesce(p_discount, 0),
      taxable_value = v_totals.taxable_value,
      cgst_amount = v_totals.cgst_amount,
      sgst_amount = v_totals.sgst_amount,
      final_price = v_totals.final_price,
      labor_charge = coalesce(p_labor_charge, 0),
      labor_sac_code = p_labor_sac_code,
      round_off = coalesce(p_round_off, false),
      round_off_amount = v_totals.round_off_amount,
      tax_inclusive_entry = coalesce(p_tax_inclusive, false),
      payment_status = v_new_payment_status
  where id = p_invoice_id;

  delete from public.invoice_items where invoice_id = p_invoice_id;

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
      p_invoice_id, v_item_type, v_product_id, v_spare_part_id,
      v_item->>'item_name', v_item->>'description', v_item->>'hsn_code',
      v_item->>'serial_imei', v_item->>'ram', v_item->>'storage',
      v_quantity, v_unit_price,
      nullif(v_item->>'cost_price', '')::numeric, v_total_price,
      nullif(v_item->>'warranty_days', '')::integer,
      coalesce(nullif(v_item->>'warranty_unit', ''), 'days'),
      v_item->>'warranty_notes'
    );
  end loop;

  select jsonb_build_object(
    'invoice', to_jsonb(i),
    'items', coalesce((
      select jsonb_agg(to_jsonb(ii) order by ii.created_at)
      from public.invoice_items ii
      where ii.invoice_id = p_invoice_id
    ), '[]'::jsonb)
  )
  into v_after_snapshot
  from public.invoices i
  where i.id = p_invoice_id;

  insert into public.invoice_amendments (
    tenant_id, invoice_id, amended_by, reason, before_snapshot, after_snapshot
  )
  values (
    v_invoice.tenant_id, p_invoice_id, auth.uid(), p_reason, v_before_snapshot, v_after_snapshot
  )
  returning id into v_amendment_id;

  select * into v_result from public.invoice_amendments where id = v_amendment_id;
  return v_result;
end;
$$;

revoke all on function public.amend_invoice(uuid, text, jsonb, numeric, numeric, text, boolean, boolean) from public;
grant execute on function public.amend_invoice(uuid, text, jsonb, numeric, numeric, text, boolean, boolean) to authenticated;
