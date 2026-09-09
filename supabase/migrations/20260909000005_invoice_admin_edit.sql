-- Admin-only "Edit Invoice" for non-financial fields (customer, and per-line
-- item name/description/HSN/serial/warranty). Implemented as a plain direct
-- table update from the client -- no RPC, since nothing here touches totals
-- or needs recalculation -- but enforced server-side by three independent
-- layers so hiding the button in the UI is not the only thing standing
-- between a non-admin (or a buggy/malicious client call) and a financial
-- field:
--
--   1. RLS UPDATE policies on invoices/invoice_items, tightened from
--      is_tenant_member (the original, apparently never actually exercised
--      by any code path -- grepped the frontend, nothing calls
--      .from('invoices').update() today) to is_tenant_admin.
--   2. Column-level GRANTs: the `authenticated` role's UPDATE privilege is
--      revoked entirely and re-granted only on the specific editable
--      columns. This is what actually makes price/quantity/discount/tax/
--      total un-touchable via this path, regardless of role -- RLS alone
--      can only restrict which *rows* are writable, not which *columns*.
--      This does not affect create_invoice/convert_invoice_to_gst/
--      void_invoice/record_invoice_payment, which run as SECURITY DEFINER
--      (i.e. as the function owner, not as `authenticated`) and are
--      therefore governed by ownership privileges, not these grants.
--   3. A trigger rejecting any update to a void or superseded invoice (or
--      the line items of one). Checked against every existing RPC that
--      updates invoices/invoice_items: each one already guards against
--      operating on an already-void/superseded invoice *before* its own
--      UPDATE statement runs, so none of them are affected by this.

drop policy invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update to authenticated
  using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

drop policy invoice_items_update on public.invoice_items;
create policy invoice_items_update on public.invoice_items
  for update to authenticated
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
        and public.is_tenant_admin(i.tenant_id)
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
        and public.is_tenant_admin(i.tenant_id)
    )
  );

revoke update on public.invoices from authenticated;
grant update (customer_id, customer_gst) on public.invoices to authenticated;

revoke update on public.invoice_items from authenticated;
grant update (
  item_name, description, hsn_code, serial_imei, ram, storage,
  warranty_days, warranty_unit, warranty_notes
) on public.invoice_items to authenticated;

create or replace function public.reject_update_on_locked_invoice()
returns trigger
language plpgsql
as $$
begin
  if old.void or old.superseded then
    raise exception 'Cannot edit a voided or superseded invoice';
  end if;
  return new;
end;
$$;

create trigger trg_invoices_reject_locked_update
  before update on public.invoices
  for each row execute function public.reject_update_on_locked_invoice();

create or replace function public.reject_update_on_locked_invoice_items()
returns trigger
language plpgsql
as $$
declare
  v_locked boolean;
begin
  select (i.void or i.superseded) into v_locked
  from public.invoices i
  where i.id = old.invoice_id;

  if v_locked then
    raise exception 'Cannot edit line items on a voided or superseded invoice';
  end if;

  return new;
end;
$$;

create trigger trg_invoice_items_reject_locked_update
  before update on public.invoice_items
  for each row execute function public.reject_update_on_locked_invoice_items();
