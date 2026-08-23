-- Customers: staff + admin can create/read/update. No delete permission was
-- granted to either role in the spec, so deletes are restricted to admins.

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  phone text not null,
  address text,
  gst_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, phone)
);

create index customers_tenant_id_idx on public.customers (tenant_id);

create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

alter table public.customers enable row level security;

create policy customers_select on public.customers
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy customers_insert on public.customers
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

create policy customers_update on public.customers
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create policy customers_delete on public.customers
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id));

revoke all on public.customers from anon, authenticated;
grant select, insert, update, delete on public.customers to authenticated;
