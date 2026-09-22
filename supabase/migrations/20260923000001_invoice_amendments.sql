-- Amend Invoice: admin-only correction of price/quantity/tax mistakes on an
-- already-issued invoice -- distinct from the existing non-financial "Edit
-- Invoice" (invoice_admin_edit.sql), which is untouched by this migration and
-- still cannot reach price/quantity/tax fields at all (its column-level
-- grants remain unchanged; amend_invoice bypasses them the same way every
-- other invoice RPC does, by running as SECURITY DEFINER).
--
-- invoice_amendments is immutable (insert + read only), same discipline as
-- credit_notes/invoice_payments: no update or delete policy, and neither
-- privilege is granted. Unlike credit_notes (any tenant member may create
-- one), only an admin may insert an amendment -- but any tenant member may
-- read the history, so staff can see why a total changed even though only an
-- admin could have made it change.

create table public.invoice_amendments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id),
  amended_by uuid not null references auth.users (id),
  amended_at timestamptz not null default now(),
  reason text not null check (btrim(reason) <> ''),
  before_snapshot jsonb not null,
  after_snapshot jsonb not null
);

create index invoice_amendments_tenant_id_idx on public.invoice_amendments (tenant_id);
create index invoice_amendments_invoice_id_idx on public.invoice_amendments (invoice_id);

alter table public.invoice_amendments enable row level security;

create policy invoice_amendments_select on public.invoice_amendments
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy invoice_amendments_insert on public.invoice_amendments
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id));

-- No update or delete policy: the table is immutable by design.

revoke all on public.invoice_amendments from anon, authenticated;
grant select, insert on public.invoice_amendments to authenticated;

-- ---------------------------------------------------------------------------
-- compute_invoice_totals: the taxable_value/cgst/sgst/final_price/round_off
-- math, extracted out of create_invoice so amend_invoice can share it exactly
-- rather than re-deriving a second copy that could drift out of sync. Pure
-- computation (no table access), so it isn't security definer and doesn't
-- need to be -- it's only ever called from inside another SECURITY DEFINER
-- function, but granted to authenticated anyway for consistency with every
-- other function in this schema.
-- ---------------------------------------------------------------------------
create or replace function public.compute_invoice_totals(
  p_items_total numeric,
  p_discount numeric,
  p_labor_charge numeric,
  p_invoice_series text,
  p_round_off boolean,
  out taxable_value numeric,
  out cgst_amount numeric,
  out sgst_amount numeric,
  out final_price numeric,
  out round_off_amount numeric
)
language plpgsql
as $$
begin
  taxable_value := coalesce(p_items_total, 0) + coalesce(p_labor_charge, 0) - coalesce(p_discount, 0);

  if p_invoice_series = 'gst' then
    cgst_amount := round(taxable_value * 0.09, 2);
    sgst_amount := round(taxable_value * 0.09, 2);
    final_price := taxable_value + cgst_amount + sgst_amount;
  else
    cgst_amount := 0;
    sgst_amount := 0;
    final_price := taxable_value;
  end if;

  if coalesce(p_round_off, false) then
    round_off_amount := round(final_price) - final_price;
    final_price := round(final_price);
  else
    round_off_amount := 0;
  end if;
end;
$$;

revoke all on function public.compute_invoice_totals(numeric, numeric, numeric, text, boolean) from public;
grant execute on function public.compute_invoice_totals(numeric, numeric, numeric, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- create_invoice: body-only replace -- signature unchanged. The manual
-- taxable_value/cgst/sgst/final_price/round_off block is now a single call
-- into compute_invoice_totals; behavior is identical to before.
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
    v_items_total, p_discount, p_labor_charge, p_invoice_series, p_round_off
  );

  v_invoice_number := public.next_invoice_number(p_tenant_id, p_invoice_series);

  insert into public.invoices (
    tenant_id, invoice_number, invoice_series, customer_id, job_sheet_id,
    customer_gst, eway_bill, discount, taxable_value, cgst_amount, sgst_amount,
    final_price, labor_charge, labor_sac_code, payment_status, amount_paid,
    round_off, round_off_amount
  )
  values (
    p_tenant_id, v_invoice_number, p_invoice_series, p_customer_id, p_job_sheet_id,
    p_customer_gst, p_eway_bill, coalesce(p_discount, 0), v_totals.taxable_value,
    v_totals.cgst_amount, v_totals.sgst_amount, v_totals.final_price,
    coalesce(p_labor_charge, 0), p_labor_sac_code,
    coalesce(p_payment_status, 'unpaid'), coalesce(p_amount_paid, 0),
    coalesce(p_round_off, false), v_totals.round_off_amount
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
-- amend_invoice: admin-only, atomic correction of an issued invoice's price/
-- quantity/tax. Captures the full before state (invoice row + all its line
-- items), recalculates totals from the new items/discount/labor/round-off
-- using the exact same math create_invoice uses, replaces the line items,
-- captures the full after state, and inserts the immutable amendment record.
--
-- Deliberately does not touch invoice_payments -- those stay as historical
-- fact -- but does recalculate payment_status against the new final_price
-- (amount_paid itself is unchanged). Also deliberately does not touch
-- inventory (product status / spare_parts quantity): this is a financial
-- restatement of the invoice, not an inventory movement, and unlike
-- create_invoice/void_invoice/create_credit_note it never adjusts stock. An
-- admin substituting a genuinely different product/spare line via this form
-- (rather than just correcting a price or quantity typo) should account for
-- stock separately.
-- ---------------------------------------------------------------------------
create or replace function public.amend_invoice(
  p_invoice_id uuid,
  p_reason text,
  p_items jsonb,
  p_discount numeric,
  p_labor_charge numeric,
  p_labor_sac_code text,
  p_round_off boolean
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
    v_items_total, p_discount, p_labor_charge, v_invoice.invoice_series, p_round_off
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

revoke all on function public.amend_invoice(uuid, text, jsonb, numeric, numeric, text, boolean) from public;
grant execute on function public.amend_invoice(uuid, text, jsonb, numeric, numeric, text, boolean) to authenticated;
