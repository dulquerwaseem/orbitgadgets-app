-- Two related gaps versus how invoices already work:
--   1. VendorPurchaseNew.tsx has no Payment fields at creation at all.
--   2. Recording a payment (PaymentsSection.tsx) does a plain insert into
--      vendor_purchase_payments and never updates vendor_purchases'
--      payment_status, so a fully-paid purchase silently stays "Unpaid" on
--      the list page forever.
-- This adds amount_paid (mirroring invoices.amount_paid exactly), a new
-- record_vendor_purchase_payment RPC that does what record_invoice_payment
-- does for invoices (admin-scoped instead of member-scoped, since this is
-- money going out), and lets create_vendor_purchase accept an initial
-- payment status/amount the same way create_invoice already does.

alter table public.vendor_purchases
  add column amount_paid numeric(12, 2) not null default 0;

-- ---------------------------------------------------------------------------
-- record_vendor_purchase_payment: same three-state logic as
-- record_invoice_payment (paid/partial/unpaid based on amount_paid vs the
-- total), but admin-only -- vendor purchases are already admin-scoped for
-- writes (see create_vendor_purchase), unlike invoice payments which are
-- staff-level.
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
  values (p_purchase_id, v_purchase.vendor_id, p_amount, coalesce(p_payment_date, current_date), p_mode, p_reference_no, p_notes)
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

revoke all on function public.record_vendor_purchase_payment(uuid, numeric, date, text, text, text) from public;
grant execute on function public.record_vendor_purchase_payment(uuid, numeric, date, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_vendor_purchase: adding p_payment_status/p_amount_paid is a genuine
-- signature change, same situation as create_job_sheet's device_password
-- and create_invoice's round_off additions -- drop the old signature first
-- so there's only ever one create_vendor_purchase. The two new params carry
-- defaults and are appended at the end (Postgres requires defaulted params
-- to trail the parameter list), matching create_invoice's p_round_off.
-- No payment history row is created at creation time -- consistent with
-- how create_invoice already behaves.
-- ---------------------------------------------------------------------------
drop function if exists public.create_vendor_purchase(
  uuid, uuid, text, date, text, text, jsonb
);

create function public.create_vendor_purchase(
  p_tenant_id uuid,
  p_vendor_id uuid,
  p_supplier_invoice_no text,
  p_purchase_date date,
  p_purchase_kind text,
  p_notes text,
  p_items jsonb,
  p_payment_status text default 'unpaid',
  p_amount_paid numeric default 0
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

  v_purchase_number := public.next_vendor_purchase_number(p_tenant_id);

  insert into public.vendor_purchases (
    tenant_id, purchase_number, vendor_id, supplier_invoice_no, purchase_date,
    purchase_kind, total_taxable_value, total_gst, grand_total, notes,
    payment_status, amount_paid
  )
  values (
    p_tenant_id, v_purchase_number, p_vendor_id, p_supplier_invoice_no, coalesce(p_purchase_date, current_date),
    p_purchase_kind, v_total_taxable_value, v_total_gst, v_grand_total, p_notes,
    coalesce(p_payment_status, 'unpaid'), coalesce(p_amount_paid, 0)
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
          tenant_id, name, brand, category, condition, ram, storage, hsn_code,
          serial_imei, purchase_price, status, vendor_id, vendor_invoice_no, purchase_date
        )
        values (
          p_tenant_id, v_item->>'item_name', v_item->>'brand', v_item->>'category', v_item->>'condition',
          v_item->>'ram', v_item->>'storage', v_item->>'hsn_code',
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
        tenant_id, name, category, quantity, purchase_price, hsn_code,
        vendor_id, vendor_invoice_no, purchase_date, tracks_serial, serial_numbers
      )
      values (
        p_tenant_id, v_item->>'item_name', v_item->>'category', v_quantity, v_unit_price, v_item->>'hsn_code',
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

revoke all on function public.create_vendor_purchase(
  uuid, uuid, text, date, text, text, jsonb, text, numeric
) from public;
grant execute on function public.create_vendor_purchase(
  uuid, uuid, text, date, text, text, jsonb, text, numeric
) to authenticated;
