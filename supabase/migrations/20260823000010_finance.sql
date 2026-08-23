-- Finance: ledger_entries (admin-managed, append-only) and expenses
-- (admin-managed, standard CRUD). Both roles can read.

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid references public.invoices (id),
  entry_type text not null check (entry_type in ('debit', 'credit')),
  account text not null,
  amount numeric(12, 2) not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ledger_entries_tenant_id_idx on public.ledger_entries (tenant_id);
create index ledger_entries_invoice_id_idx on public.ledger_entries (invoice_id);

alter table public.ledger_entries enable row level security;

create policy ledger_entries_select on public.ledger_entries
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy ledger_entries_insert on public.ledger_entries
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id));

-- No update or delete policy: the ledger is append-only by design.

revoke all on public.ledger_entries from anon, authenticated;
grant select, insert on public.ledger_entries to authenticated;

-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  category text,
  description text,
  amount numeric(12, 2) not null,
  expense_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expenses_tenant_id_idx on public.expenses (tenant_id);

create trigger trg_expenses_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

alter table public.expenses enable row level security;

create policy expenses_select on public.expenses
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id));

create policy expenses_update on public.expenses
  for update to authenticated
  using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

create policy expenses_delete on public.expenses
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id));

revoke all on public.expenses from anon, authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
