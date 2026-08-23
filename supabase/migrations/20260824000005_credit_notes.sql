-- Credit notes: returns against an existing invoice, with restocking.
-- credit_notes is immutable by design (insert + select only, enforced by
-- RLS in the original schema migration) -- this RPC only ever inserts one
-- row; it never updates a credit note afterward. The only mutations here
-- are the restocking side effects on products/spare_parts.

-- ---------------------------------------------------------------------------
-- credit_note_number_counters: one counter per tenant, same shape as the
-- job sheet / quotation counters.
-- ---------------------------------------------------------------------------
create table public.credit_note_number_counters (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  last_number integer not null default 0
);

alter table public.credit_note_number_counters enable row level security;
revoke all on public.credit_note_number_counters from anon, authenticated;

create or replace function public.next_credit_note_number(p_tenant_id uuid)
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

  insert into public.credit_note_number_counters (tenant_id, last_number)
  values (p_tenant_id, 1)
  on conflict (tenant_id)
  do update set last_number = credit_note_number_counters.last_number + 1
  returning last_number into v_next;

  return 'CN-' || lpad(v_next::text, 5, '0');
end;
$$;

revoke all on function public.next_credit_note_number(uuid) from public;
grant execute on function public.next_credit_note_number(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_credit_note: p_items is a jsonb array of
-- { invoice_item_id, quantity_returned }. Deliberately thin -- the client
-- only names which line and how much, never prices or names; those are
-- looked up server-side from the real invoice_items row so a credit note's
-- numbers can't be manipulated by the caller. Also guards against returning
-- more than was ever sold on a line, summed across any prior credit notes
-- against the same invoice (since credit notes are immutable, this is the
-- only chance to prevent a bad row -- there's no fixing it after the fact).
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

revoke all on function public.create_credit_note(uuid, uuid, text, text, jsonb) from public;
grant execute on function public.create_credit_note(uuid, uuid, text, text, jsonb) to authenticated;
