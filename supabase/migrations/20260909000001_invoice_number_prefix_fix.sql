-- next_invoice_number was minting numbers under a different scheme (GST-/
-- NGST- prefixes, counters starting from 0) than the historical data
-- migration used (OG-GST-/OG-INV- prefixes, already up to OG-GST-00012 and
-- OG-INV-00039). That let a live invoice (GST-00002) get created alongside
-- the historical OG-GST-* sequence instead of continuing it. This migration
-- switches the prefixes to match history exactly and reconciles each
-- series' counter to the real historical max, so the next invoice in each
-- series picks up right after the historical data with no gap or collision.
-- GST-00002 itself is a real, paid invoice and is left as-is -- this only
-- changes what gets generated going forward.

update public.invoice_number_counters c
set last_number = greatest(c.last_number, h.max_number)
from (
  select tenant_id, max(substring(invoice_number from 8)::int) as max_number
  from public.invoices
  where invoice_number like 'OG-GST-%'
  group by tenant_id
) h
where c.tenant_id = h.tenant_id and c.series = 'gst';

insert into public.invoice_number_counters (tenant_id, series, last_number)
select tenant_id, 'non_gst', max(substring(invoice_number from 8)::int)
from public.invoices
where invoice_number like 'OG-INV-%'
group by tenant_id
on conflict (tenant_id, series) do update
set last_number = greatest(invoice_number_counters.last_number, excluded.last_number);

-- ---------------------------------------------------------------------------
-- next_invoice_number: signature unchanged, body-only replace to switch the
-- generated prefix from GST-/NGST- to OG-GST-/OG-INV-.
-- ---------------------------------------------------------------------------
create or replace function public.next_invoice_number(p_tenant_id uuid, p_series text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
  v_prefix text;
begin
  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  if p_series not in ('gst', 'non_gst') then
    raise exception 'Invalid invoice series: %', p_series;
  end if;

  insert into public.invoice_number_counters (tenant_id, series, last_number)
  values (p_tenant_id, p_series, 1)
  on conflict (tenant_id, series)
  do update set last_number = invoice_number_counters.last_number + 1
  returning last_number into v_next;

  v_prefix := case when p_series = 'gst' then 'OG-GST' else 'OG-INV' end;

  return v_prefix || '-' || lpad(v_next::text, 5, '0');
end;
$$;

revoke all on function public.next_invoice_number(uuid, text) from public;
grant execute on function public.next_invoice_number(uuid, text) to authenticated;
