-- Vendor sourcing: vendor_purchases, vendor_purchase_items are admin-managed
-- (both roles can still read). vendor_purchase_payments and
-- vendor_debit_notes are additionally immutable (insert + read only).

create table public.vendor_purchases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  purchase_number text not null,
  vendor_id uuid not null references public.vendors (id),
  supplier_invoice_no text,
  purchase_date date not null default current_date,
  payment_status text not null default 'unpaid',
  purchase_kind text,
  total_taxable_value numeric(12, 2) not null default 0,
  total_gst numeric(12, 2) not null default 0,
  grand_total numeric(12, 2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, purchase_number)
);

create index vendor_purchases_tenant_id_idx on public.vendor_purchases (tenant_id);
create index vendor_purchases_vendor_id_idx on public.vendor_purchases (vendor_id);

create trigger trg_vendor_purchases_updated_at
  before update on public.vendor_purchases
  for each row execute function public.set_updated_at();

alter table public.vendor_purchases enable row level security;

create policy vendor_purchases_select on public.vendor_purchases
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy vendor_purchases_insert on public.vendor_purchases
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id));

create policy vendor_purchases_update on public.vendor_purchases
  for update to authenticated
  using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

create policy vendor_purchases_delete on public.vendor_purchases
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id));

revoke all on public.vendor_purchases from anon, authenticated;
grant select, insert, update, delete on public.vendor_purchases to authenticated;

-- ---------------------------------------------------------------------------
-- vendor_purchase_items: no tenant_id column, RLS scopes through the parent
-- purchase.
-- ---------------------------------------------------------------------------
create table public.vendor_purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.vendor_purchases (id) on delete cascade,
  item_type text,
  item_name text not null,
  brand text,
  category text,
  hsn_code text,
  description text,
  ram text,
  storage text,
  condition text,
  unit_price numeric(12, 2) not null default 0,
  quantity numeric(12, 2) not null default 1,
  gst_rate numeric(5, 2) not null default 0,
  taxable_value numeric(12, 2) not null default 0,
  gst_amount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  serials text[],
  product_ids uuid[],
  spare_part_id uuid references public.spare_parts (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vendor_purchase_items_purchase_id_idx on public.vendor_purchase_items (purchase_id);
create index vendor_purchase_items_spare_part_id_idx on public.vendor_purchase_items (spare_part_id);

create trigger trg_vendor_purchase_items_updated_at
  before update on public.vendor_purchase_items
  for each row execute function public.set_updated_at();

alter table public.vendor_purchase_items enable row level security;

create policy vendor_purchase_items_select on public.vendor_purchase_items
  for select to authenticated
  using (
    exists (
      select 1 from public.vendor_purchases vp
      where vp.id = vendor_purchase_items.purchase_id
        and public.is_tenant_member(vp.tenant_id)
    )
  );

create policy vendor_purchase_items_insert on public.vendor_purchase_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.vendor_purchases vp
      where vp.id = vendor_purchase_items.purchase_id
        and public.is_tenant_admin(vp.tenant_id)
    )
  );

create policy vendor_purchase_items_update on public.vendor_purchase_items
  for update to authenticated
  using (
    exists (
      select 1 from public.vendor_purchases vp
      where vp.id = vendor_purchase_items.purchase_id
        and public.is_tenant_admin(vp.tenant_id)
    )
  )
  with check (
    exists (
      select 1 from public.vendor_purchases vp
      where vp.id = vendor_purchase_items.purchase_id
        and public.is_tenant_admin(vp.tenant_id)
    )
  );

create policy vendor_purchase_items_delete on public.vendor_purchase_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.vendor_purchases vp
      where vp.id = vendor_purchase_items.purchase_id
        and public.is_tenant_admin(vp.tenant_id)
    )
  );

revoke all on public.vendor_purchase_items from anon, authenticated;
grant select, insert, update, delete on public.vendor_purchase_items to authenticated;

-- ---------------------------------------------------------------------------
-- vendor_purchase_payments: admin-managed, immutable (insert + read only).
-- ---------------------------------------------------------------------------
create table public.vendor_purchase_payments (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.vendor_purchases (id) on delete cascade,
  vendor_id uuid not null references public.vendors (id),
  amount numeric(12, 2) not null,
  payment_date date not null default current_date,
  mode text,
  reference_no text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vendor_purchase_payments_purchase_id_idx on public.vendor_purchase_payments (purchase_id);
create index vendor_purchase_payments_vendor_id_idx on public.vendor_purchase_payments (vendor_id);

alter table public.vendor_purchase_payments enable row level security;

create policy vendor_purchase_payments_select on public.vendor_purchase_payments
  for select to authenticated
  using (
    exists (
      select 1 from public.vendor_purchases vp
      where vp.id = vendor_purchase_payments.purchase_id
        and public.is_tenant_member(vp.tenant_id)
    )
  );

create policy vendor_purchase_payments_insert on public.vendor_purchase_payments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.vendor_purchases vp
      where vp.id = vendor_purchase_payments.purchase_id
        and public.is_tenant_admin(vp.tenant_id)
    )
  );

-- No update or delete policy: the table is immutable by design.

revoke all on public.vendor_purchase_payments from anon, authenticated;
grant select, insert on public.vendor_purchase_payments to authenticated;

-- ---------------------------------------------------------------------------
-- vendor_debit_notes: admin-managed, immutable (insert + read only).
-- ---------------------------------------------------------------------------
create table public.vendor_debit_notes (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.vendor_purchases (id) on delete cascade,
  purchase_item_id uuid references public.vendor_purchase_items (id),
  vendor_id uuid not null references public.vendors (id),
  quantity_deducted numeric(12, 2) not null default 0,
  adjustment_amount_inclusive_tax numeric(12, 2) not null default 0,
  reason text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vendor_debit_notes_purchase_id_idx on public.vendor_debit_notes (purchase_id);
create index vendor_debit_notes_purchase_item_id_idx on public.vendor_debit_notes (purchase_item_id);
create index vendor_debit_notes_vendor_id_idx on public.vendor_debit_notes (vendor_id);

alter table public.vendor_debit_notes enable row level security;

create policy vendor_debit_notes_select on public.vendor_debit_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.vendor_purchases vp
      where vp.id = vendor_debit_notes.purchase_id
        and public.is_tenant_member(vp.tenant_id)
    )
  );

create policy vendor_debit_notes_insert on public.vendor_debit_notes
  for insert to authenticated
  with check (
    exists (
      select 1 from public.vendor_purchases vp
      where vp.id = vendor_debit_notes.purchase_id
        and public.is_tenant_admin(vp.tenant_id)
    )
  );

-- No update or delete policy: the table is immutable by design.

revoke all on public.vendor_debit_notes from anon, authenticated;
grant select, insert on public.vendor_debit_notes to authenticated;
