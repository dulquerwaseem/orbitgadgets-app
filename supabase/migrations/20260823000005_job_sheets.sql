-- Job sheets: operational only, no money fields. Staff + admin can
-- create/read/update. invoice_id's FK is added once invoices exists
-- (migration 0006) since the two tables reference each other.

create table public.job_sheets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  job_number text not null,
  status text not null default 'intake' check (status in ('intake', 'in_progress', 'ready', 'delivered')),
  customer_id uuid references public.customers (id),
  device_name text,
  device_brand text,
  device_imei text,
  device_color text,
  reported_problem text,
  physical_condition text,
  accessories_received text,
  technician_notes text,
  estimated_ready_date date,
  delivered_at timestamptz,
  invoice_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, job_number)
);

create index job_sheets_tenant_id_idx on public.job_sheets (tenant_id);
create index job_sheets_customer_id_idx on public.job_sheets (customer_id);
create index job_sheets_invoice_id_idx on public.job_sheets (invoice_id);

create trigger trg_job_sheets_updated_at
  before update on public.job_sheets
  for each row execute function public.set_updated_at();

alter table public.job_sheets enable row level security;

create policy job_sheets_select on public.job_sheets
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy job_sheets_insert on public.job_sheets
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

create policy job_sheets_update on public.job_sheets
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create policy job_sheets_delete on public.job_sheets
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id));

revoke all on public.job_sheets from anon, authenticated;
grant select, insert, update, delete on public.job_sheets to authenticated;

-- ---------------------------------------------------------------------------
-- job_sheet_parts: reference only, no pricing. No tenant_id column, so RLS
-- scopes through the parent job_sheet.
-- ---------------------------------------------------------------------------
create table public.job_sheet_parts (
  id uuid primary key default gen_random_uuid(),
  job_sheet_id uuid not null references public.job_sheets (id) on delete cascade,
  spare_part_id uuid references public.spare_parts (id),
  part_name text not null,
  quantity integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index job_sheet_parts_job_sheet_id_idx on public.job_sheet_parts (job_sheet_id);
create index job_sheet_parts_spare_part_id_idx on public.job_sheet_parts (spare_part_id);

create trigger trg_job_sheet_parts_updated_at
  before update on public.job_sheet_parts
  for each row execute function public.set_updated_at();

alter table public.job_sheet_parts enable row level security;

create policy job_sheet_parts_select on public.job_sheet_parts
  for select to authenticated
  using (
    exists (
      select 1 from public.job_sheets js
      where js.id = job_sheet_parts.job_sheet_id
        and public.is_tenant_member(js.tenant_id)
    )
  );

create policy job_sheet_parts_insert on public.job_sheet_parts
  for insert to authenticated
  with check (
    exists (
      select 1 from public.job_sheets js
      where js.id = job_sheet_parts.job_sheet_id
        and public.is_tenant_member(js.tenant_id)
    )
  );

create policy job_sheet_parts_update on public.job_sheet_parts
  for update to authenticated
  using (
    exists (
      select 1 from public.job_sheets js
      where js.id = job_sheet_parts.job_sheet_id
        and public.is_tenant_member(js.tenant_id)
    )
  )
  with check (
    exists (
      select 1 from public.job_sheets js
      where js.id = job_sheet_parts.job_sheet_id
        and public.is_tenant_member(js.tenant_id)
    )
  );

create policy job_sheet_parts_delete on public.job_sheet_parts
  for delete to authenticated
  using (
    exists (
      select 1 from public.job_sheets js
      where js.id = job_sheet_parts.job_sheet_id
        and public.is_tenant_admin(js.tenant_id)
    )
  );

revoke all on public.job_sheet_parts from anon, authenticated;
grant select, insert, update, delete on public.job_sheet_parts to authenticated;
