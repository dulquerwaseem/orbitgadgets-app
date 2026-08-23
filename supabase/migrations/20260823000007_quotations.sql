-- Quotations: quotations, quotation_items. Staff + admin can create/read/update.

create table public.quotations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  quotation_number text not null,
  customer_id uuid references public.customers (id),
  invoice_series text not null check (invoice_series in ('gst', 'non_gst')),
  labor_charge numeric(12, 2) not null default 0,
  labor_sac_code text,
  discount numeric(12, 2) not null default 0,
  subtotal numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  valid_until date,
  notes text,
  status text not null default 'pending',
  converted_invoice_id uuid references public.invoices (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, quotation_number)
);

create index quotations_tenant_id_idx on public.quotations (tenant_id);
create index quotations_customer_id_idx on public.quotations (customer_id);
create index quotations_converted_invoice_id_idx on public.quotations (converted_invoice_id);

create trigger trg_quotations_updated_at
  before update on public.quotations
  for each row execute function public.set_updated_at();

alter table public.quotations enable row level security;

create policy quotations_select on public.quotations
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy quotations_insert on public.quotations
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

create policy quotations_update on public.quotations
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create policy quotations_delete on public.quotations
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id));

revoke all on public.quotations from anon, authenticated;
grant select, insert, update, delete on public.quotations to authenticated;

-- ---------------------------------------------------------------------------
-- quotation_items: same shape as invoice_items plus quotation_id.
-- ---------------------------------------------------------------------------
create table public.quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  item_type text not null check (item_type in ('product', 'spare', 'service', 'custom')),
  product_id uuid references public.products (id),
  spare_part_id uuid references public.spare_parts (id),
  item_name text not null,
  description text,
  hsn_code text,
  serial_imei text,
  ram text,
  storage text,
  quantity numeric(12, 2) not null default 1,
  unit_price numeric(12, 2) not null default 0,
  cost_price numeric(12, 2),
  total_price numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index quotation_items_quotation_id_idx on public.quotation_items (quotation_id);
create index quotation_items_product_id_idx on public.quotation_items (product_id);
create index quotation_items_spare_part_id_idx on public.quotation_items (spare_part_id);

create trigger trg_quotation_items_updated_at
  before update on public.quotation_items
  for each row execute function public.set_updated_at();

alter table public.quotation_items enable row level security;

create policy quotation_items_select on public.quotation_items
  for select to authenticated
  using (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_items.quotation_id
        and public.is_tenant_member(q.tenant_id)
    )
  );

create policy quotation_items_insert on public.quotation_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_items.quotation_id
        and public.is_tenant_member(q.tenant_id)
    )
  );

create policy quotation_items_update on public.quotation_items
  for update to authenticated
  using (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_items.quotation_id
        and public.is_tenant_member(q.tenant_id)
    )
  )
  with check (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_items.quotation_id
        and public.is_tenant_member(q.tenant_id)
    )
  );

create policy quotation_items_delete on public.quotation_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.quotations q
      where q.id = quotation_items.quotation_id
        and public.is_tenant_admin(q.tenant_id)
    )
  );

revoke all on public.quotation_items from anon, authenticated;
grant select, insert, update, delete on public.quotation_items to authenticated;
