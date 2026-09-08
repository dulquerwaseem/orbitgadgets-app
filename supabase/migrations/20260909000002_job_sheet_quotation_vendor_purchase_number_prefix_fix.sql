-- Same problem as invoice numbering (20260909000001), same fix, applied to
-- the other three numbered-document series: next_job_number(),
-- next_quotation_number(), and next_vendor_purchase_number() were all
-- minting numbers under a different prefix (JOB-/QT-/PO-) than the
-- historical data migration used (OG-JOB-/OG-QT-/OG-PUR-), with counters
-- starting from 0 instead of continuing the real historical sequence.
--
-- Job sheets and quotations: no live document has been created under the
-- wrong scheme yet (both counter tables are empty), so this is a pure
-- pre-emptive fix -- nothing to leave alone here.
--
-- Vendor purchases: PO-00001 is a real purchase already created under the
-- wrong scheme (confirmed earlier, ₹8,614, dated 2026-09-07) and is left
-- exactly as-is, same treatment as invoice GST-00002 -- this migration only
-- changes what gets generated going forward.

insert into public.job_sheet_number_counters (tenant_id, last_number)
select tenant_id, max(substring(job_number from '[0-9]+$')::int)
from public.job_sheets
where job_number like 'OG-JOB-%'
group by tenant_id
on conflict (tenant_id) do update
set last_number = greatest(job_sheet_number_counters.last_number, excluded.last_number);

insert into public.quotation_number_counters (tenant_id, last_number)
select tenant_id, max(substring(quotation_number from '[0-9]+$')::int)
from public.quotations
where quotation_number like 'OG-QT-%'
group by tenant_id
on conflict (tenant_id) do update
set last_number = greatest(quotation_number_counters.last_number, excluded.last_number);

insert into public.vendor_purchase_number_counters (tenant_id, last_number)
select tenant_id, max(substring(purchase_number from '[0-9]+$')::int)
from public.vendor_purchases
where purchase_number like 'OG-PUR-%'
group by tenant_id
on conflict (tenant_id) do update
set last_number = greatest(vendor_purchase_number_counters.last_number, excluded.last_number);

-- ---------------------------------------------------------------------------
-- next_job_number: signature unchanged, body-only replace to switch the
-- generated prefix from JOB- to OG-JOB-.
-- ---------------------------------------------------------------------------
create or replace function public.next_job_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  insert into public.job_sheet_number_counters (tenant_id, last_number)
  values (p_tenant_id, 1)
  on conflict (tenant_id)
  do update set last_number = job_sheet_number_counters.last_number + 1
  returning last_number into v_next;

  return 'OG-JOB-' || lpad(v_next::text, 5, '0');
end;
$$;

revoke all on function public.next_job_number(uuid) from public;
grant execute on function public.next_job_number(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- next_quotation_number: signature unchanged, body-only replace to switch
-- the generated prefix from QT- to OG-QT-.
-- ---------------------------------------------------------------------------
create or replace function public.next_quotation_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  insert into public.quotation_number_counters (tenant_id, last_number)
  values (p_tenant_id, 1)
  on conflict (tenant_id)
  do update set last_number = quotation_number_counters.last_number + 1
  returning last_number into v_next;

  return 'OG-QT-' || lpad(v_next::text, 5, '0');
end;
$$;

revoke all on function public.next_quotation_number(uuid) from public;
grant execute on function public.next_quotation_number(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- next_vendor_purchase_number: signature unchanged, body-only replace to
-- switch the generated prefix from PO- to OG-PUR- (matching the historical
-- format exactly, confirmed live -- not "OG-PO-").
-- ---------------------------------------------------------------------------
create or replace function public.next_vendor_purchase_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  if not public.is_tenant_admin(p_tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  insert into public.vendor_purchase_number_counters (tenant_id, last_number)
  values (p_tenant_id, 1)
  on conflict (tenant_id)
  do update set last_number = vendor_purchase_number_counters.last_number + 1
  returning last_number into v_next;

  return 'OG-PUR-' || lpad(v_next::text, 5, '0');
end;
$$;

revoke all on function public.next_vendor_purchase_number(uuid) from public;
grant execute on function public.next_vendor_purchase_number(uuid) to authenticated;
