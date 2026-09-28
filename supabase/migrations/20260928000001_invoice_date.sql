-- Invoices get a real, editable invoice_date, separate from created_at (the
-- literal moment the row was inserted, which the app has been displaying and
-- sorting by up to now). invoice_date is what actually belongs on a tax
-- document -- staff should be able to backdate an invoice created today for
-- a sale that happened yesterday, and correcting a wrong date later should
-- go through the same admin-only, reason-required, audited path as every
-- other financial correction (amend_invoice, change_invoice_date below).
--
-- Backfilled from created_at converted to Asia/Kolkata -- NOT current_date
-- and NOT created_at::date, both of which read the server's UTC clock and
-- would put a late-evening-IST invoice on the wrong (earlier) day. Verified
-- against three known rows before writing this: OG-INV-00039 -> 2026-08-21,
-- OG-GST-00013 -> 2026-09-08, OG-GST-00019 -> 2026-09-22, all correct.

alter table public.invoices add column invoice_date date;

-- trg_invoices_reject_locked_update (invoice_admin_edit.sql) rejects any
-- update touching a void/superseded invoice, including this one -- it exists
-- to stop *application* edits from reaching a locked invoice's financial/
-- customer fields, not to block a one-time backfill of a brand new column
-- that didn't exist when those rows were locked. Disabled only for the
-- duration of this single backfill statement, then immediately re-enabled;
-- no application code path is affected.
alter table public.invoices disable trigger trg_invoices_reject_locked_update;

update public.invoices
set invoice_date = (created_at at time zone 'Asia/Kolkata')::date;

alter table public.invoices enable trigger trg_invoices_reject_locked_update;

alter table public.invoices alter column invoice_date set not null;

create index invoices_invoice_date_idx on public.invoices (invoice_date);

-- ---------------------------------------------------------------------------
-- create_invoice: adding p_invoice_date is a genuine signature change, same
-- treatment as every previous addition (p_round_off, p_tax_inclusive) --
-- drop the old 14-arg version, create the 15-arg one. Null means "today in
-- India" -- computed server-side via (now() at time zone 'Asia/Kolkata')::date,
-- never current_date (that reads the server's UTC clock and would land on
-- yesterday for any invoice created after 18:30 UTC / before 00:00 IST).
-- The future-date check runs before next_invoice_number() is called, so a
-- rejected call never burns a real invoice number.
--
-- convert_quotation_to_invoice calls create_invoice positionally with the
-- original 12 arguments (tenant_id .. items) and relies on every argument
-- added since then defaulting -- p_round_off, p_tax_inclusive, and now
-- p_invoice_date are all trailing with defaults, so that call is untouched
-- and keeps working exactly as before (same reasoning that already applied
-- when p_round_off and p_tax_inclusive were added, and already verified live
-- both times).
-- ---------------------------------------------------------------------------
drop function if exists public.create_invoice(
  uuid, text, uuid, uuid, text, text, numeric, numeric, text, text, numeric, jsonb, boolean, boolean
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
  p_tax_inclusive boolean default false,
  p_invoice_date date default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_number text;
  v_invoice_id uuid;
  v_invoice_date date;
  v_india_today date;
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

  v_india_today := (now() at time zone 'Asia/Kolkata')::date;
  v_invoice_date := coalesce(p_invoice_date, v_india_today);

  if v_invoice_date > v_india_today then
    raise exception 'Invoice date cannot be in the future (today in India is %)', v_india_today;
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
    round_off, round_off_amount, tax_inclusive_entry, invoice_date
  )
  values (
    p_tenant_id, v_invoice_number, p_invoice_series, p_customer_id, p_job_sheet_id,
    p_customer_gst, p_eway_bill, coalesce(p_discount, 0), v_totals.taxable_value,
    v_totals.cgst_amount, v_totals.sgst_amount, v_totals.final_price,
    coalesce(p_labor_charge, 0), p_labor_sac_code,
    coalesce(p_payment_status, 'unpaid'), coalesce(p_amount_paid, 0),
    coalesce(p_round_off, false), v_totals.round_off_amount, coalesce(p_tax_inclusive, false),
    v_invoice_date
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
  uuid, text, uuid, uuid, text, text, numeric, numeric, text, text, numeric, jsonb, boolean, boolean, date
) from public;
grant execute on function public.create_invoice(
  uuid, text, uuid, uuid, text, text, numeric, numeric, text, text, numeric, jsonb, boolean, boolean, date
) to authenticated;

-- ---------------------------------------------------------------------------
-- convert_invoice_to_gst: signature unchanged, body-only replace -- the new
-- invoice copies the source invoice's invoice_date exactly (a GST conversion
-- is a re-statement of the same sale, not a new one, so its date shouldn't
-- silently jump to today).
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
    round_off, round_off_amount, invoice_date
  )
  values (
    v_source.tenant_id, v_new_number, 'gst', v_source.customer_id, v_source.job_sheet_id,
    v_source.customer_gst, v_source.eway_bill, v_source.discount, v_source.taxable_value,
    v_cgst_amount, v_sgst_amount, v_final_price,
    v_source.labor_charge, v_source.labor_sac_code,
    v_source.status, v_source.payment_status, v_source.amount_paid, v_source.id,
    v_source.round_off, v_round_off_amount, v_source.invoice_date
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

-- ---------------------------------------------------------------------------
-- change_invoice_date: admin-only, reason-required correction of an issued
-- invoice's date, same audit-trail discipline as amend_invoice (immutable
-- invoice_amendments row with before/after snapshots) but deliberately a
-- separate RPC -- amend_invoice touches price/quantity/tax, this touches
-- only invoice_date, and neither widens what the other can reach. Does not
-- add invoice_date to the direct-update column grant on invoices
-- (invoice_admin_edit.sql's `grant update (customer_id, customer_gst)`) --
-- this stays the only path to it, same as amend_invoice is the only path to
-- price/quantity/tax.
-- ---------------------------------------------------------------------------
create or replace function public.change_invoice_date(
  p_invoice_id uuid,
  p_new_date date,
  p_reason text
)
returns public.invoice_amendments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_india_today date;
  v_before_snapshot jsonb;
  v_after_snapshot jsonb;
  v_amendment_id uuid;
  v_result public.invoice_amendments%rowtype;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;

  if v_invoice.id is null then
    raise exception 'Invoice not found';
  end if;

  if not public.is_tenant_admin(v_invoice.tenant_id) then
    raise exception 'Only a tenant admin can change an invoice date';
  end if;

  if v_invoice.void then
    raise exception 'Cannot change the date of a voided invoice';
  end if;

  if v_invoice.superseded then
    raise exception 'Cannot change the date of a superseded invoice';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to change an invoice date';
  end if;

  if p_new_date is null then
    raise exception 'A new date is required';
  end if;

  v_india_today := (now() at time zone 'Asia/Kolkata')::date;

  if p_new_date > v_india_today then
    raise exception 'Invoice date cannot be in the future (today in India is %)', v_india_today;
  end if;

  select jsonb_build_object(
    'invoice', to_jsonb(v_invoice),
    'items', coalesce((
      select jsonb_agg(to_jsonb(ii) order by ii.created_at)
      from public.invoice_items ii
      where ii.invoice_id = p_invoice_id
    ), '[]'::jsonb)
  ) into v_before_snapshot;

  update public.invoices
  set invoice_date = p_new_date
  where id = p_invoice_id;

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

revoke all on function public.change_invoice_date(uuid, date, text) from public;
grant execute on function public.change_invoice_date(uuid, date, text) to authenticated;
