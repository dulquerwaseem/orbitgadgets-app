-- Billing: invoices, invoice_items. Staff + admin can create/read/update.

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_number text not null,
  invoice_series text not null check (invoice_series in ('gst', 'non_gst')),
  customer_id uuid references public.customers (id),
  job_sheet_id uuid references public.job_sheets (id),
  customer_gst text,
  eway_bill text,
  discount numeric(12, 2) not null default 0,
  final_price numeric(12, 2) not null default 0,
  labor_charge numeric(12, 2) not null default 0,
  labor_sac_code text,
  status text not null default 'draft',
  payment_status text not null default 'unpaid',
  amount_paid numeric(12, 2) not null default 0,
  converted_from_invoice_id uuid references public.invoices (id),
  superseded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, invoice_number)
);

create index invoices_tenant_id_idx on public.invoices (tenant_id);
create index invoices_customer_id_idx on public.invoices (customer_id);
create index invoices_job_sheet_id_idx on public.invoices (job_sheet_id);
create index invoices_converted_from_invoice_id_idx on public.invoices (converted_from_invoice_id);

create trigger trg_invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;

create policy invoices_select on public.invoices
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

create policy invoices_update on public.invoices
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create policy invoices_delete on public.invoices
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id));

revoke all on public.invoices from anon, authenticated;
grant select, insert, update, delete on public.invoices to authenticated;

-- Now that invoices exists, close the loop from job_sheets.invoice_id.
alter table public.job_sheets
  add constraint job_sheets_invoice_id_fkey
  foreign key (invoice_id) references public.invoices (id);

-- ---------------------------------------------------------------------------
-- invoice_items: no tenant_id column, RLS scopes through the parent invoice.
-- ---------------------------------------------------------------------------
create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
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

create index invoice_items_invoice_id_idx on public.invoice_items (invoice_id);
create index invoice_items_product_id_idx on public.invoice_items (product_id);
create index invoice_items_spare_part_id_idx on public.invoice_items (spare_part_id);

create trigger trg_invoice_items_updated_at
  before update on public.invoice_items
  for each row execute function public.set_updated_at();

alter table public.invoice_items enable row level security;

create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
        and public.is_tenant_member(i.tenant_id)
    )
  );

create policy invoice_items_insert on public.invoice_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
        and public.is_tenant_member(i.tenant_id)
    )
  );

create policy invoice_items_update on public.invoice_items
  for update to authenticated
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
        and public.is_tenant_member(i.tenant_id)
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
        and public.is_tenant_member(i.tenant_id)
    )
  );

create policy invoice_items_delete on public.invoice_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
        and public.is_tenant_admin(i.tenant_id)
    )
  );

revoke all on public.invoice_items from anon, authenticated;
grant select, insert, update, delete on public.invoice_items to authenticated;
