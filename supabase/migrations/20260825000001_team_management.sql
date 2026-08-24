-- Team management: named members with fine-grained staff permissions, plus a
-- narrow self-service RPC for updating one's own display name.
--
-- Permission keys map to app feature areas:
--   invoicing         -> Invoices / Quotations / Credit Notes (full staff access)
--   job_sheets        -> Job Sheets (full staff access)
--   inventory         -> Products / Spare Parts (full staff access)
--   vendor_purchases  -> Vendors / Vendor Purchases (view-only for staff; writes
--                        already require is_tenant_admin at the RLS layer)
--   finance           -> Finance (view-only for staff; writes already require
--                        is_tenant_admin at the RLS layer)

alter table public.tenant_members
  add column name text,
  add column permissions text[] not null default '{}';

alter table public.tenant_members
  add constraint tenant_members_permissions_valid check (
    permissions <@ array['invoicing', 'job_sheets', 'inventory', 'vendor_purchases', 'finance']::text[]
  );

-- ---------------------------------------------------------------------------
-- update_own_name: deliberately narrow. Only touches the caller's own name,
-- never role/permissions, so it's safe to expose to staff without adding a
-- broad self-update RLS policy on tenant_members (which would risk letting
-- staff edit their own role or permissions).
-- ---------------------------------------------------------------------------
create or replace function public.update_own_name(p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tenant_members
  set name = p_name
  where user_id = auth.uid();
end;
$$;

revoke all on function public.update_own_name(text) from public;
grant execute on function public.update_own_name(text) to authenticated;
