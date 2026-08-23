-- Invoicing: per-tenant/per-series invoice numbering, and two RPCs
-- (create_invoice, convert_invoice_to_gst) that wrap multi-table writes in a
-- single transaction so an invoice, its line items, and the inventory side
-- effects (marking a product sold, deducting spare_parts stock) never end up
-- partially applied.

-- ---------------------------------------------------------------------------
-- invoice_number_counters: backing store for atomic per-tenant/per-series
-- sequences. Locked down entirely -- only next_invoice_number() (security
-- definer) may touch it.
-- ---------------------------------------------------------------------------
create table public.invoice_number_counters (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  series text not null check (series in ('gst', 'non_gst')),
  last_number integer not null default 0,
  primary key (tenant_id, series)
);

alter table public.invoice_number_counters enable row level security;
-- No policies: this table has no direct access, even for authenticated.
revoke all on public.invoice_number_counters from anon, authenticated;

create or replace function public.next_invoice_number(p_tenant_id uuid, p_series text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
  v_prefix text;
begin
  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  if p_series not in ('gst', 'non_gst') then
    raise exception 'Invalid invoice series: %', p_series;
  end if;

  insert into public.invoice_number_counters (tenant_id, series, last_number)
  values (p_tenant_id, p_series, 1)
  on conflict (tenant_id, series)
  do update set last_number = invoice_number_counters.last_number + 1
  returning last_number into v_next;

  v_prefix := case when p_series = 'gst' then 'GST' else 'NGST' end;

  return v_prefix || '-' || lpad(v_next::text, 5, '0');
end;
$$;

revoke all on function public.next_invoice_number(uuid, text) from public;
grant execute on function public.next_invoice_number(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_invoice: creates an invoice plus its line items in one transaction,
-- computes totals server-side, marks invoiced products 'sold', and deducts
-- spare_parts stock (raising if insufficient). p_items is a jsonb array of
-- objects: { item_type, product_id, spare_part_id, item_name, description,
-- hsn_code, serial_imei, ram, storage, quantity, unit_price, cost_price }.
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
  p_items jsonb
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
  v_final_price numeric;
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

  v_final_price := v_items_total + coalesce(p_labor_charge, 0) - coalesce(p_discount, 0);

  v_invoice_number := public.next_invoice_number(p_tenant_id, p_invoice_series);

  insert into public.invoices (
    tenant_id, invoice_number, invoice_series, customer_id, job_sheet_id,
    customer_gst, eway_bill, discount, final_price, labor_charge, labor_sac_code,
    payment_status, amount_paid
  )
  values (
    p_tenant_id, v_invoice_number, p_invoice_series, p_customer_id, p_job_sheet_id,
    p_customer_gst, p_eway_bill, coalesce(p_discount, 0), v_final_price,
    coalesce(p_labor_charge, 0), p_labor_sac_code,
    coalesce(p_payment_status, 'unpaid'), coalesce(p_amount_paid, 0)
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
      hsn_code, serial_imei, ram, storage, quantity, unit_price, cost_price, total_price
    )
    values (
      v_invoice_id, v_item_type, v_product_id, v_spare_part_id,
      v_item->>'item_name', v_item->>'description', v_item->>'hsn_code',
      v_item->>'serial_imei', v_item->>'ram', v_item->>'storage',
      v_quantity, v_unit_price,
      nullif(v_item->>'cost_price', '')::numeric, v_total_price
    );

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
  uuid, text, uuid, uuid, text, text, numeric, numeric, text, text, numeric, jsonb
) from public;
grant execute on function public.create_invoice(
  uuid, text, uuid, uuid, text, text, numeric, numeric, text, text, numeric, jsonb
) to authenticated;

-- ---------------------------------------------------------------------------
-- convert_invoice_to_gst: clones a non_gst invoice (and its line items) into
-- a new gst invoice, links converted_from_invoice_id back to the original,
-- and marks the original superseded. Does not touch inventory -- the items
-- were already applied (product sold / stock deducted) when the original
-- invoice was created.
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

  v_new_number := public.next_invoice_number(v_source.tenant_id, 'gst');

  insert into public.invoices (
    tenant_id, invoice_number, invoice_series, customer_id, job_sheet_id,
    customer_gst, eway_bill, discount, final_price, labor_charge, labor_sac_code,
    status, payment_status, amount_paid, converted_from_invoice_id
  )
  values (
    v_source.tenant_id, v_new_number, 'gst', v_source.customer_id, v_source.job_sheet_id,
    v_source.customer_gst, v_source.eway_bill, v_source.discount, v_source.final_price,
    v_source.labor_charge, v_source.labor_sac_code,
    v_source.status, v_source.payment_status, v_source.amount_paid, v_source.id
  )
  returning id into v_new_id;

  insert into public.invoice_items (
    invoice_id, item_type, product_id, spare_part_id, item_name, description,
    hsn_code, serial_imei, ram, storage, quantity, unit_price, cost_price, total_price
  )
  select
    v_new_id, item_type, product_id, spare_part_id, item_name, description,
    hsn_code, serial_imei, ram, storage, quantity, unit_price, cost_price, total_price
  from public.invoice_items
  where invoice_id = v_source.id;

  update public.invoices set superseded = true where id = v_source.id;

  select * into v_result from public.invoices where id = v_new_id;
  return v_result;
end;
$$;

revoke all on function public.convert_invoice_to_gst(uuid) from public;
grant execute on function public.convert_invoice_to_gst(uuid) to authenticated;
