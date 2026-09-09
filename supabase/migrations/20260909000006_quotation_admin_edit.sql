-- Same admin-only non-financial edit ability as invoices
-- (20260909000005_invoice_admin_edit.sql), applied to quotations. Same three
-- enforcement layers, same reasoning -- see that migration's header comment
-- for the full explanation. Differences from the invoice version, both
-- deliberate: quotation_items never had warranty fields (excluded earlier,
-- consistent with quotations being non-binding drafts), so there's nothing
-- warranty-related to whitelist here; and quotations has no customer_gst
-- column at all, so there's no GST-refresh concern -- customer_id is the
-- only editable column on the quotations table itself. The lock condition
-- is status = 'converted' (checked against converted_invoice_id too, since
-- convert_quotation_to_invoice sets both together) instead of void/
-- superseded, and confirmed (like void_invoice) that
-- convert_quotation_to_invoice already guards against re-converting an
-- already-converted quotation before its own UPDATE runs, so it's
-- unaffected by this trigger.

drop policy quotations_update on public.quotations;
create policy quotations_update on public.quotations
  for update to authenticated
  using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

drop policy quotation_items_update on public.quotation_items;
create policy quotation_items_update on public.quotation_items
  for update to authenticated
  using (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_items.quotation_id
        and public.is_tenant_admin(q.tenant_id)
    )
  )
  with check (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_items.quotation_id
        and public.is_tenant_admin(q.tenant_id)
    )
  );

revoke update on public.quotations from authenticated;
grant update (customer_id) on public.quotations to authenticated;

revoke update on public.quotation_items from authenticated;
grant update (
  item_name, description, hsn_code, serial_imei, ram, storage
) on public.quotation_items to authenticated;

create or replace function public.reject_update_on_locked_quotation()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'converted' or old.converted_invoice_id is not null then
    raise exception 'Cannot edit a converted quotation';
  end if;
  return new;
end;
$$;

create trigger trg_quotations_reject_locked_update
  before update on public.quotations
  for each row execute function public.reject_update_on_locked_quotation();

create or replace function public.reject_update_on_locked_quotation_items()
returns trigger
language plpgsql
as $$
declare
  v_locked boolean;
begin
  select (q.status = 'converted' or q.converted_invoice_id is not null) into v_locked
  from public.quotations q
  where q.id = old.quotation_id;

  if v_locked then
    raise exception 'Cannot edit line items on a converted quotation';
  end if;

  return new;
end;
$$;

create trigger trg_quotation_items_reject_locked_update
  before update on public.quotation_items
  for each row execute function public.reject_update_on_locked_quotation_items();
