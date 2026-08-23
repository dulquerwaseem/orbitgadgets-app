-- Quotations: draft estimates that touch no stock/revenue until converted.
-- Adds tax columns to match invoices' taxable_value/cgst_amount/sgst_amount
-- split, a dedicated quotation numbering sequence, a create_quotation RPC
-- (same atomic shape as create_invoice but no product/stock side effects),
-- and convert_quotation_to_invoice, which calls the existing create_invoice
-- RPC directly so the real sale gets the exact same correctness guarantees
-- (server-computed totals, product-sold marking, stock deduction) rather
-- than duplicating that logic.

-- ---------------------------------------------------------------------------
-- quotations already has subtotal/total; add the same cgst/sgst split
-- invoices got, so a gst quotation's tax breakdown is stored, not just its
-- final total.
-- ---------------------------------------------------------------------------
alter table public.quotations
  add column cgst_amount numeric(12, 2) not null default 0,
  add column sgst_amount numeric(12, 2) not null default 0;

-- ---------------------------------------------------------------------------
-- quotation_number_counters: one counter per tenant (quotations have no
-- series, same shape as job_sheet_number_counters).
-- ---------------------------------------------------------------------------
create table public.quotation_number_counters (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  last_number integer not null default 0
);

alter table public.quotation_number_counters enable row level security;
revoke all on public.quotation_number_counters from anon, authenticated;

create or replace function public.next_quotation_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  insert into public.quotation_number_counters (tenant_id, last_number)
  values (p_tenant_id, 1)
  on conflict (tenant_id)
  do update set last_number = quotation_number_counters.last_number + 1
  returning last_number into v_next;

  return 'QT-' || lpad(v_next::text, 5, '0');
end;
$$;

revoke all on function public.next_quotation_number(uuid) from public;
grant execute on function public.next_quotation_number(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_quotation: mirrors create_invoice's validation and tax math, but
-- never touches products/spare_parts -- a quotation is just a stored
-- estimate until it's converted.
-- ---------------------------------------------------------------------------
create or replace function public.create_quotation(
  p_tenant_id uuid,
  p_invoice_series text,
  p_customer_id uuid,
  p_discount numeric,
  p_labor_charge numeric,
  p_labor_sac_code text,
  p_valid_until date,
  p_notes text,
  p_items jsonb
)
returns public.quotations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation_number text;
  v_quotation_id uuid;
  v_items_total numeric := 0;
  v_subtotal numeric;
  v_cgst_amount numeric;
  v_sgst_amount numeric;
  v_total numeric;
  v_item jsonb;
  v_quantity numeric;
  v_unit_price numeric;
  v_total_price numeric;
  v_result public.quotations%rowtype;
begin
  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  if p_invoice_series not in ('gst', 'non_gst') then
    raise exception 'Invalid invoice series: %', p_invoice_series;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Quotation must have at least one line item';
  end if;

  if p_customer_id is not null then
    perform 1 from public.customers where id = p_customer_id and tenant_id = p_tenant_id;
    if not found then
      raise exception 'Customer not found for this tenant';
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

  v_subtotal := v_items_total + coalesce(p_labor_charge, 0) - coalesce(p_discount, 0);

  if p_invoice_series = 'gst' then
    v_cgst_amount := round(v_subtotal * 0.09, 2);
    v_sgst_amount := round(v_subtotal * 0.09, 2);
    v_total := v_subtotal + v_cgst_amount + v_sgst_amount;
  else
    v_cgst_amount := 0;
    v_sgst_amount := 0;
    v_total := v_subtotal;
  end if;

  v_quotation_number := public.next_quotation_number(p_tenant_id);

  insert into public.quotations (
    tenant_id, quotation_number, customer_id, invoice_series,
    labor_charge, labor_sac_code, discount, subtotal, cgst_amount, sgst_amount, total,
    valid_until, notes
  )
  values (
    p_tenant_id, v_quotation_number, p_customer_id, p_invoice_series,
    coalesce(p_labor_charge, 0), p_labor_sac_code, coalesce(p_discount, 0),
    v_subtotal, v_cgst_amount, v_sgst_amount, v_total,
    p_valid_until, p_notes
  )
  returning id into v_quotation_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_total_price := v_quantity * v_unit_price;

    insert into public.quotation_items (
      quotation_id, item_type, product_id, spare_part_id, item_name, description,
      hsn_code, serial_imei, ram, storage, quantity, unit_price, cost_price, total_price
    )
    values (
      v_quotation_id, v_item->>'item_type',
      nullif(v_item->>'product_id', '')::uuid,
      nullif(v_item->>'spare_part_id', '')::uuid,
      v_item->>'item_name', v_item->>'description', v_item->>'hsn_code',
      v_item->>'serial_imei', v_item->>'ram', v_item->>'storage',
      v_quantity, v_unit_price,
      nullif(v_item->>'cost_price', '')::numeric, v_total_price
    );
  end loop;

  select * into v_result from public.quotations where id = v_quotation_id;
  return v_result;
end;
$$;

revoke all on function public.create_quotation(
  uuid, text, uuid, numeric, numeric, text, date, text, jsonb
) from public;
grant execute on function public.create_quotation(
  uuid, text, uuid, numeric, numeric, text, date, text, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- convert_quotation_to_invoice: builds the same items jsonb shape
-- create_invoice expects from quotation_items, then calls create_invoice
-- directly -- so the resulting invoice gets real stock deduction / product
-- sold-marking / server-computed totals, identical to a manually created
-- invoice. Then links the quotation to the new invoice and marks it
-- converted.
-- ---------------------------------------------------------------------------
create or replace function public.convert_quotation_to_invoice(p_quotation_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation public.quotations%rowtype;
  v_customer_gst text;
  v_items jsonb;
  v_invoice public.invoices%rowtype;
begin
  select * into v_quotation from public.quotations where id = p_quotation_id;

  if v_quotation.id is null then
    raise exception 'Quotation not found';
  end if;

  if not public.is_tenant_member(v_quotation.tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  if v_quotation.status = 'converted' or v_quotation.converted_invoice_id is not null then
    raise exception 'Quotation has already been converted';
  end if;

  if v_quotation.customer_id is not null then
    select gst_number into v_customer_gst
    from public.customers
    where id = v_quotation.customer_id;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'item_type', item_type,
        'product_id', product_id,
        'spare_part_id', spare_part_id,
        'item_name', item_name,
        'description', description,
        'hsn_code', hsn_code,
        'serial_imei', serial_imei,
        'ram', ram,
        'storage', storage,
        'quantity', quantity,
        'unit_price', unit_price,
        'cost_price', cost_price
      )
    ),
    '[]'::jsonb
  )
  into v_items
  from public.quotation_items
  where quotation_id = v_quotation.id;

  v_invoice := public.create_invoice(
    v_quotation.tenant_id,
    v_quotation.invoice_series,
    v_quotation.customer_id,
    null,
    v_customer_gst,
    null,
    v_quotation.discount,
    v_quotation.labor_charge,
    v_quotation.labor_sac_code,
    'unpaid',
    0,
    v_items
  );

  update public.quotations
  set converted_invoice_id = v_invoice.id, status = 'converted'
  where id = v_quotation.id;

  return v_invoice;
end;
$$;

revoke all on function public.convert_quotation_to_invoice(uuid) from public;
grant execute on function public.convert_quotation_to_invoice(uuid) to authenticated;
