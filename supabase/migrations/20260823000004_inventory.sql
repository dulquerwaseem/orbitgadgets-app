-- Inventory: products, spare_parts. Staff + admin can create/read/update.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  category text,
  brand text,
  serial_imei text,
  ram text,
  storage text,
  condition text,
  purchase_price numeric(12, 2),
  selling_price numeric(12, 2),
  battery_health integer,
  warranty_expiry date,
  status text,
  image_url text,
  video_url text,
  key_highlights text[],
  description text,
  notes text,
  device_age_value numeric(6, 2),
  device_age_unit text,
  has_original_bill boolean not null default false,
  has_original_box boolean not null default false,
  hsn_code text,
  vendor_id uuid references public.vendors (id),
  vendor_invoice_no text,
  purchase_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_tenant_id_idx on public.products (tenant_id);
create index products_vendor_id_idx on public.products (vendor_id);

create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.products enable row level security;

create policy products_select on public.products
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy products_insert on public.products
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

create policy products_update on public.products
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create policy products_delete on public.products
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id));

revoke all on public.products from anon, authenticated;
grant select, insert, update, delete on public.products to authenticated;

-- ---------------------------------------------------------------------------
create table public.spare_parts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  part_number text,
  category text,
  compatible_models text[],
  quantity integer not null default 0,
  reorder_level integer,
  purchase_price numeric(12, 2),
  selling_price numeric(12, 2),
  hsn_code text,
  vendor_id uuid references public.vendors (id),
  vendor_invoice_no text,
  purchase_date date,
  tracks_serial boolean not null default false,
  serial_numbers text[],
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index spare_parts_tenant_id_idx on public.spare_parts (tenant_id);
create index spare_parts_vendor_id_idx on public.spare_parts (vendor_id);

create trigger trg_spare_parts_updated_at
  before update on public.spare_parts
  for each row execute function public.set_updated_at();

alter table public.spare_parts enable row level security;

create policy spare_parts_select on public.spare_parts
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy spare_parts_insert on public.spare_parts
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

create policy spare_parts_update on public.spare_parts
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create policy spare_parts_delete on public.spare_parts
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id));

revoke all on public.spare_parts from anon, authenticated;
grant select, insert, update, delete on public.spare_parts to authenticated;
