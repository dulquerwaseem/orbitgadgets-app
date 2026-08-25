-- "Returned" job sheet status: device given back to the customer without
-- being repaired/delivered (declined quote, part unavailable, not economical
-- to fix, etc.) -- distinct from "Delivered". Plain status + reason, no RPC
-- needed since (unlike void_invoice) there's no atomicity/inventory-reversal
-- concern here: setting status='returned' doesn't undo anything, and staff
-- can still separately bill a diagnostic fee via a normal invoice afterward.

alter table public.job_sheets drop constraint job_sheets_status_check;

alter table public.job_sheets
  add constraint job_sheets_status_check
  check (status in ('intake', 'in_progress', 'ready', 'delivered', 'returned'));

alter table public.job_sheets
  add column return_reason text;
