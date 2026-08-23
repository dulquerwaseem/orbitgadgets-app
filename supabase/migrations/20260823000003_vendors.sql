-- Vendors: admin-only writes, both roles can read. Created before inventory
-- tables since products/spare_parts reference vendor_id.

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  contact_phone text,
  contact_email text,
  gstin text,
  address text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vendors_tenant_id_idx on public.vendors (tenant_id);

create trigger trg_vendors_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

alter table public.vendors enable row level security;

create policy vendors_select on public.vendors
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy vendors_insert on public.vendors
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id));

create policy vendors_update on public.vendors
  for update to authenticated
  using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

create policy vendors_delete on public.vendors
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id));

revoke all on public.vendors from anon, authenticated;
grant select, insert, update, delete on public.vendors to authenticated;
