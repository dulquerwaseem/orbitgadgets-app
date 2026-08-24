-- Invoice payments: staff-level (not admin-only, unlike vendor purchase
-- payments) since these are recorded customer-facing at the front desk.
-- Immutable (insert + read only) -- same discipline as vendor_purchase_payments.

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  amount numeric(12, 2) not null,
  payment_date date not null default current_date,
  mode text,
  reference_no text,
  notes text,
  created_at timestamptz not null default now()
);

create index invoice_payments_invoice_id_idx on public.invoice_payments (invoice_id);

alter table public.invoice_payments enable row level security;

create policy invoice_payments_select on public.invoice_payments
  for select to authenticated
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_payments.invoice_id
        and public.is_tenant_member(i.tenant_id)
    )
  );

create policy invoice_payments_insert on public.invoice_payments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_payments.invoice_id
        and public.is_tenant_member(i.tenant_id)
    )
  );

-- No update or delete policy: the table is immutable by design.

revoke all on public.invoice_payments from anon, authenticated;
grant select, insert on public.invoice_payments to authenticated;

-- ---------------------------------------------------------------------------
-- record_invoice_payment: atomically inserts the payment row and keeps
-- invoices.amount_paid/payment_status in sync, since Overview, the Invoices
-- list, and the GST export all read those columns directly rather than
-- summing invoice_payments themselves. Guards against over-payment the same
-- way create_credit_note guards against over-return: read the current state,
-- check the new total against the cap, reject before writing anything.
-- ---------------------------------------------------------------------------
create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_mode text,
  p_reference_no text,
  p_notes text
)
returns public.invoice_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_new_amount_paid numeric;
  v_new_status text;
  v_result public.invoice_payments%rowtype;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id;

  if v_invoice.id is null then
    raise exception 'Invoice not found';
  end if;

  if not public.is_tenant_member(v_invoice.tenant_id) then
    raise exception 'Not authorized for this tenant';
  end if;

  if v_invoice.superseded then
    raise exception 'Cannot record a payment against a superseded invoice';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  v_new_amount_paid := v_invoice.amount_paid + p_amount;

  if v_new_amount_paid > v_invoice.final_price then
    raise exception 'Payment of % would exceed the balance due (% of % already paid)',
      p_amount, v_invoice.amount_paid, v_invoice.final_price;
  end if;

  insert into public.invoice_payments (invoice_id, amount, payment_date, mode, reference_no, notes)
  values (p_invoice_id, p_amount, coalesce(p_payment_date, current_date), p_mode, p_reference_no, p_notes)
  returning * into v_result;

  v_new_status := case
    when v_new_amount_paid >= v_invoice.final_price then 'paid'
    when v_new_amount_paid > 0 then 'partial'
    else 'unpaid'
  end;

  update public.invoices
  set amount_paid = v_new_amount_paid,
      payment_status = v_new_status
  where id = p_invoice_id;

  return v_result;
end;
$$;

revoke all on function public.record_invoice_payment(uuid, numeric, date, text, text, text) from public;
grant execute on function public.record_invoice_payment(uuid, numeric, date, text, text, text) to authenticated;
