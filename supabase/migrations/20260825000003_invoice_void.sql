-- Void invoices: for genuine same-day data-entry mistakes (wrong customer,
-- mistyped price) -- distinct from a credit note, which is for real
-- returns/refunds against an otherwise-correct sale. A void is only allowed
-- on a clean, untouched invoice: no payments, no credit notes. Once voided,
-- the invoice must stay that way -- record_invoice_payment, create_credit_note,
-- and convert_invoice_to_gst are all redefined below to reject a voided
-- invoice too, so the "clean mistake, forever" invariant holds even if
-- something is called directly against the RPC rather than through the UI.

alter table public.invoices
  add column void boolean not null default false,
  add column void_reason text;

-- ---------------------------------------------------------------------------
-- void_invoice: reverses inventory effects the same way create_credit_note's
-- restocking does (product line items -> status back to 'available', spare
-- line items -> quantity added back), then marks the invoice void. Rejects
-- if the invoice already has real financial activity against it (payments
-- or credit notes) -- those cases should use a credit note instead.
-- ---------------------------------------------------------------------------
create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_item public.invoice_items%rowtype;
  v_payment_count integer;
  v_credit_note_count integer;
  v_result public.invoices%rowtype;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;

  if v_invoice.id is null then
    raise exception 'Invoice not found';
  end if;

  if not public.is_tenant_member(v_invoice.tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  if v_invoice.superseded then
    raise exception 'Cannot void a superseded invoice';
  end if;

  if v_invoice.void then
    raise exception 'Invoice is already void';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to void an invoice';
  end if;

  select count(*) into v_payment_count
  from public.invoice_payments
  where invoice_id = p_invoice_id;

  if v_payment_count > 0 then
    raise exception 'Cannot void: % payment(s) already recorded against this invoice. Use a credit note instead.',
      v_payment_count;
  end if;

  select count(*) into v_credit_note_count
  from public.credit_notes
  where invoice_id = p_invoice_id;

  if v_credit_note_count > 0 then
    raise exception 'Cannot void: % credit note(s) already exist against this invoice.', v_credit_note_count;
  end if;

  for v_item in select * from public.invoice_items where invoice_id = p_invoice_id
  loop
    if v_item.item_type = 'product' and v_item.product_id is not null then
      update public.products
      set status = 'available'
      where id = v_item.product_id and tenant_id = v_invoice.tenant_id;
    elsif v_item.item_type = 'spare' and v_item.spare_part_id is not null then
      update public.spare_parts
      set quantity = quantity + v_item.quantity
      where id = v_item.spare_part_id and tenant_id = v_invoice.tenant_id;
    end if;
  end loop;

  update public.invoices
  set void = true,
      void_reason = p_reason
  where id = p_invoice_id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.void_invoice(uuid, text) from public;
grant execute on function public.void_invoice(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- record_invoice_payment: redefined only to add a void guard. Everything
-- else is unchanged from the original definition.
-- ---------------------------------------------------------------------------
create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_mode text,
  p_reference_no text,
  p_notes text
)
returns public.invoice_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_new_amount_paid numeric;
  v_new_status text;
  v_result public.invoice_payments%rowtype;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;

  if v_invoice.id is null then
    raise exception 'Invoice not found';
  end if;

  if not public.is_tenant_member(v_invoice.tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  if v_invoice.superseded then
    raise exception 'Cannot record a payment against a superseded invoice';
  end if;

  if v_invoice.void then
    raise exception 'Cannot record a payment against a voided invoice';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  v_new_amount_paid := v_invoice.amount_paid + p_amount;

  if v_new_amount_paid > v_invoice.final_price then
    raise exception 'Payment of % would exceed the balance due (% of % already paid)',
      p_amount, v_invoice.amount_paid, v_invoice.final_price;
  end if;

  insert into public.invoice_payments (invoice_id, amount, payment_date, mode, reference_no, notes)
  values (p_invoice_id, p_amount, coalesce(p_payment_date, current_date), p_mode, p_reference_no, p_notes)
  returning * into v_result;

  v_new_status := case
    when v_new_amount_paid >= v_invoice.final_price then 'paid'
    when v_new_amount_paid > 0 then 'partial'
    else 'unpaid'
  end;

  update public.invoices
  set amount_paid = v_new_amount_paid,
      payment_status = v_new_status
  where id = p_invoice_id;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_credit_note: redefined only to add a void guard. Everything else
-- is unchanged from the original definition.
-- ---------------------------------------------------------------------------
create or replace function public.create_credit_note(
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_reason text,
  p_notes text,
  p_items jsonb
)
returns public.credit_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_credit_note_number text;
  v_credit_note_id uuid;
  v_item jsonb;
  v_invoice_item public.invoice_items%rowtype;
  v_quantity_returned numeric;
  v_already_returned numeric;
  v_line_total numeric;
  v_subtotal numeric := 0;
  v_taxable_value numeric := 0;
  v_cgst numeric := 0;
  v_sgst numeric := 0;
  v_total_refunded numeric;
  v_items_returned jsonb := '[]'::jsonb;
  v_product_ids_restocked uuid[] := '{}';
  v_spare_parts_restocked jsonb := '[]'::jsonb;
  v_result public.credit_notes%rowtype;
begin
  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id and tenant_id = p_tenant_id;

  if v_invoice.id is null then
    raise exception 'Invoice not found for this tenant';
  end if;

  if v_invoice.superseded then
    raise exception 'Cannot create a credit note against a superseded invoice';
  end if;

  if v_invoice.void then
    raise exception 'Cannot create a credit note against a voided invoice';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Credit note must include at least one returned item';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_invoice_item
    from public.invoice_items
    where id = (v_item->>'invoice_item_id')::uuid
      and invoice_id = p_invoice_id;

    if v_invoice_item.id is null then
      raise exception 'Invoice item % not found on this invoice', v_item->>'invoice_item_id';
    end if;

    v_quantity_returned := coalesce((v_item->>'quantity_returned')::numeric, 0);

    if v_quantity_returned <= 0 then
      raise exception 'Quantity returned must be greater than zero';
    end if;

    select coalesce(sum((elem->>'quantity_returned')::numeric), 0)
    into v_already_returned
    from public.credit_notes cn,
         jsonb_array_elements(cn.items_returned) elem
    where cn.invoice_id = p_invoice_id
      and (elem->>'invoice_item_id')::uuid = v_invoice_item.id;

    if v_already_returned + v_quantity_returned > v_invoice_item.quantity then
      raise exception 'Cannot return % of "%": % of % already returned',
        v_quantity_returned, v_invoice_item.item_name, v_already_returned, v_invoice_item.quantity;
    end if;

    v_line_total := v_invoice_item.unit_price * v_quantity_returned;
    v_subtotal := v_subtotal + v_line_total;

    v_items_returned := v_items_returned || jsonb_build_object(
      'invoice_item_id', v_invoice_item.id,
      'item_type', v_invoice_item.item_type,
      'item_name', v_invoice_item.item_name,
      'product_id', v_invoice_item.product_id,
      'spare_part_id', v_invoice_item.spare_part_id,
      'quantity_returned', v_quantity_returned,
      'unit_price', v_invoice_item.unit_price,
      'line_total', v_line_total
    );

    if v_invoice_item.item_type = 'product' and v_invoice_item.product_id is not null then
      update public.products
      set status = 'available'
      where id = v_invoice_item.product_id and tenant_id = p_tenant_id;

      v_product_ids_restocked := array_append(v_product_ids_restocked, v_invoice_item.product_id);
    elsif v_invoice_item.item_type = 'spare' and v_invoice_item.spare_part_id is not null then
      update public.spare_parts
      set quantity = quantity + v_quantity_returned
      where id = v_invoice_item.spare_part_id and tenant_id = p_tenant_id;

      v_spare_parts_restocked := v_spare_parts_restocked || jsonb_build_object(
        'spare_part_id', v_invoice_item.spare_part_id,
        'quantity_restocked', v_quantity_returned
      );
    end if;
  end loop;

  if v_invoice.invoice_series = 'gst' then
    v_taxable_value := v_subtotal;
    v_cgst := round(v_taxable_value * 0.09, 2);
    v_sgst := round(v_taxable_value * 0.09, 2);
    v_total_refunded := v_taxable_value + v_cgst + v_sgst;
  else
    v_taxable_value := 0;
    v_cgst := 0;
    v_sgst := 0;
    v_total_refunded := v_subtotal;
  end if;

  v_credit_note_number := public.next_credit_note_number(p_tenant_id);

  insert into public.credit_notes (
    tenant_id, credit_note_number, invoice_id, is_gst, customer_id,
    reason, notes, items_returned, product_ids_restocked, spare_parts_restocked,
    subtotal, taxable_value, cgst, sgst, total_refunded
  )
  values (
    p_tenant_id, v_credit_note_number, p_invoice_id, v_invoice.invoice_series = 'gst', v_invoice.customer_id,
    p_reason, p_notes, v_items_returned, v_product_ids_restocked, v_spare_parts_restocked,
    v_subtotal, v_taxable_value, v_cgst, v_sgst, v_total_refunded
  )
  returning id into v_credit_note_id;

  select * into v_result from public.credit_notes where id = v_credit_note_id;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- convert_invoice_to_gst: redefined only to add a void guard. Everything
-- else is unchanged from the original definition.
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

  v_new_number := public.next_invoice_number(v_source.tenant_id, 'gst');

  insert into public.invoices (
    tenant_id, invoice_number, invoice_series, customer_id, job_sheet_id,
    customer_gst, eway_bill, discount, taxable_value, cgst_amount, sgst_amount,
    final_price, labor_charge, labor_sac_code,
    status, payment_status, amount_paid, converted_from_invoice_id
  )
  values (
    v_source.tenant_id, v_new_number, 'gst', v_source.customer_id, v_source.job_sheet_id,
    v_source.customer_gst, v_source.eway_bill, v_source.discount, v_source.taxable_value,
    v_cgst_amount, v_sgst_amount, v_final_price,
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
