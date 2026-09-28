-- Same bug class just fixed for invoice_date: current_date reads the
-- server's UTC clock, not India's. Between 00:00-05:29 IST the server is
-- still on the previous UTC calendar day, so every current_date default or
-- fallback below would silently backdate a payment/purchase/return/expense
-- recorded in that window by one day. Replaced everywhere with
-- (now() at time zone 'Asia/Kolkata')::date, the same expression
-- invoice_date's create_invoice/change_invoice_date already use.
--
-- Scope found via a live, exhaustive search (pg_proc.prosrc and
-- information_schema.columns.column_default ilike '%current_date%'/
-- '%now()::date%', across all functions, column defaults, triggers, and
-- views in the public schema) -- not just the four columns flagged in the
-- prior session's report. That search turned up one the report missed:
-- vendor_purchase_payments.payment_date also defaulted to current_date.

-- ---------------------------------------------------------------------------
-- Column defaults.
-- ---------------------------------------------------------------------------
alter table public.credit_notes
  alter column return_date set default (now() at time zone 'Asia/Kolkata')::date;

alter table public.expenses
  alter column expense_date set default (now() at time zone 'Asia/Kolkata')::date;

alter table public.vendor_purchases
  alter column purchase_date set default (now() at time zone 'Asia/Kolkata')::date;

alter table public.invoice_payments
  alter column payment_date set default (now() at time zone 'Asia/Kolkata')::date;

-- Not in the original flagged list -- found by the exhaustive search above.
alter table public.vendor_purchase_payments
  alter column payment_date set default (now() at time zone 'Asia/Kolkata')::date;

-- ---------------------------------------------------------------------------
-- record_invoice_payment: signature unchanged, body-only replace -- only
-- the coalesce(p_payment_date, current_date) fallback changes.
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
  values (
    p_invoice_id, p_amount,
    coalesce(p_payment_date, (now() at time zone 'Asia/Kolkata')::date),
    p_mode, p_reference_no, p_notes
  )
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
-- record_vendor_purchase_payment: signature unchanged, body-only replace --
-- same single-line fallback change as record_invoice_payment above.
-- ---------------------------------------------------------------------------
create or replace function public.record_vendor_purchase_payment(
  p_purchase_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_mode text,
  p_reference_no text,
  p_notes text
)
returns public.vendor_purchase_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase public.vendor_purchases%rowtype;
  v_new_amount_paid numeric;
  v_new_status text;
  v_result public.vendor_purchase_payments%rowtype;
begin
  select * into v_purchase from public.vendor_purchases where id = p_purchase_id;

  if v_purchase.id is null then
    raise exception 'Purchase not found';
  end if;

  if not public.is_tenant_admin(v_purchase.tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  v_new_amount_paid := v_purchase.amount_paid + p_amount;

  if v_new_amount_paid > v_purchase.grand_total then
    raise exception 'Payment of % would exceed the balance due (% of % already paid)',
      p_amount, v_purchase.amount_paid, v_purchase.grand_total;
  end if;

  insert into public.vendor_purchase_payments (purchase_id, vendor_id, amount, payment_date, mode, reference_no, notes)
  values (
    p_purchase_id, v_purchase.vendor_id, p_amount,
    coalesce(p_payment_date, (now() at time zone 'Asia/Kolkata')::date),
    p_mode, p_reference_no, p_notes
  )
  returning * into v_result;

  v_new_status := case
    when v_new_amount_paid >= v_purchase.grand_total then 'paid'
    when v_new_amount_paid > 0 then 'partial'
    else 'unpaid'
  end;

  update public.vendor_purchases
  set amount_paid = v_new_amount_paid,
      payment_status = v_new_status
  where id = p_purchase_id;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_vendor_purchase: signature unchanged, body-only replace -- only the
-- coalesce(p_purchase_date, current_date) fallback in the vendor_purchases
-- insert changes. Deliberately NOT touching the products/spare_parts inserts
-- further down, which already pass p_purchase_date through uncoalesced (so a
-- null p_purchase_date leaves their purchase_date null even though the
-- parent vendor_purchases row gets today) -- that's a pre-existing
-- inconsistency in this function, out of scope for a timezone fix, and not
-- introduced or changed here.
-- ---------------------------------------------------------------------------
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
    p_tenant_id, v_purchase_number, p_vendor_id, p_supplier_invoice_no,
    coalesce(p_purchase_date, (now() at time zone 'Asia/Kolkata')::date),
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
