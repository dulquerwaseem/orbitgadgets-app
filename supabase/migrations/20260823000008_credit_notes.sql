-- Credit notes: staff + admin can create/read. Immutable: no UPDATE or
-- DELETE policy is defined, and neither privilege is granted, so no role
-- (including admin) can modify or remove a row once inserted.

create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  credit_note_number text not null,
  invoice_id uuid not null references public.invoices (id),
  is_gst boolean not null default false,
  customer_id uuid references public.customers (id),
  return_date date not null default current_date,
  reason text,
  notes text,
  items_returned jsonb not null default '[]'::jsonb,
  product_ids_restocked uuid[],
  spare_parts_restocked jsonb not null default '[]'::jsonb,
  subtotal numeric(12, 2) not null default 0,
  taxable_value numeric(12, 2) not null default 0,
  cgst numeric(12, 2) not null default 0,
  sgst numeric(12, 2) not null default 0,
  total_refunded numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, credit_note_number)
);

create index credit_notes_tenant_id_idx on public.credit_notes (tenant_id);
create index credit_notes_invoice_id_idx on public.credit_notes (invoice_id);
create index credit_notes_customer_id_idx on public.credit_notes (customer_id);

alter table public.credit_notes enable row level security;

create policy credit_notes_select on public.credit_notes
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy credit_notes_insert on public.credit_notes
  for insert to authenticated
  with check (public.is_tenant_member(tenant_id));

-- No update or delete policy: the table is immutable by design.

revoke all on public.credit_notes from anon, authenticated;
grant select, insert on public.credit_notes to authenticated;
