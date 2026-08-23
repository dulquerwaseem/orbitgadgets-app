-- Tenancy: tenants, tenant_members, RLS helper functions, shared trigger utilities.
-- No public/anonymous access anywhere in this schema: every policy is scoped to
-- the "authenticated" role and checks membership via tenant_members.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current on every mutable table.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tenants_owner_id_idx on public.tenants (owner_id);

create trigger trg_tenants_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- tenant_members
-- ---------------------------------------------------------------------------
create table public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  email text not null,
  role text not null check (role in ('admin', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index tenant_members_tenant_id_idx on public.tenant_members (tenant_id);
create index tenant_members_user_id_idx on public.tenant_members (user_id);

create trigger trg_tenant_members_updated_at
  before update on public.tenant_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helper functions.
-- security definer so they can read tenant_members without recursing through
-- tenant_members' own RLS policies; search_path locked down for safety.
-- ---------------------------------------------------------------------------
create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
  );
$$;

create or replace function public.is_tenant_admin(p_tenant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.role = 'admin'
  );
$$;

revoke all on function public.is_tenant_member(uuid) from public;
revoke all on function public.is_tenant_admin(uuid) from public;
grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.is_tenant_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Bootstrap trigger: when a tenant is created, add its owner as the first
-- admin member. security definer so it bypasses tenant_members' admin-only
-- insert policy (there is no admin yet at this point).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenant_members (tenant_id, user_id, email, role)
  values (
    new.id,
    new.owner_id,
    coalesce((select u.email from auth.users u where u.id = new.owner_id), ''),
    'admin'
  );
  return new;
end;
$$;

create trigger trg_tenants_after_insert
  after insert on public.tenants
  for each row execute function public.handle_new_tenant();

-- ---------------------------------------------------------------------------
-- RLS: tenants
-- ---------------------------------------------------------------------------
alter table public.tenants enable row level security;

create policy tenants_select on public.tenants
  for select to authenticated
  using (public.is_tenant_member(id));

create policy tenants_insert on public.tenants
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy tenants_update on public.tenants
  for update to authenticated
  using (public.is_tenant_admin(id))
  with check (public.is_tenant_admin(id));

create policy tenants_delete on public.tenants
  for delete to authenticated
  using (public.is_tenant_admin(id));

revoke all on public.tenants from anon, authenticated;
grant select, insert, update, delete on public.tenants to authenticated;

-- ---------------------------------------------------------------------------
-- RLS: tenant_members (admin-only writes, both roles read)
-- ---------------------------------------------------------------------------
alter table public.tenant_members enable row level security;

create policy tenant_members_select on public.tenant_members
  for select to authenticated
  using (public.is_tenant_member(tenant_id));

create policy tenant_members_insert on public.tenant_members
  for insert to authenticated
  with check (public.is_tenant_admin(tenant_id));

create policy tenant_members_update on public.tenant_members
  for update to authenticated
  using (public.is_tenant_admin(tenant_id))
  with check (public.is_tenant_admin(tenant_id));

create policy tenant_members_delete on public.tenant_members
  for delete to authenticated
  using (public.is_tenant_admin(tenant_id));

revoke all on public.tenant_members from anon, authenticated;
grant select, insert, update, delete on public.tenant_members to authenticated;
