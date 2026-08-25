# Orbitgadgets Data Migration — Field Mapping Specification

Validated against the actual exported CSVs on 2026-08-25. Every formula below was
cross-checked against real data before being finalized — see "Validation" notes.

## Core strategy

- **Reuse original UUIDs wherever the source table had them.** UUIDs are globally
  unique, so products/vendors/invoices/etc. keep their exact old `id`. This means
  every foreign key (invoice_items.product_id, vendor_purchase_items.product_ids,
  job_sheet_parts.spare_part_id, etc.) transfers automatically with zero remapping.
- **Only `customers` needs new IDs** — the old app never had a customers table.
- **Preserve original invoice/job-sheet/quotation/purchase numbers exactly**
  (e.g. "OG-INV-00005", "OG-GST-00003", "OG-JOB-00034"). Do not renumber. The new
  app's auto-numbering (GST-00001, NGST-00001, JOB-00001...) uses different
  prefixes, so there is zero collision risk — new counters simply stay at 0 and
  the first invoice created after go-live starts clean.
- **Preserve original `created_at`/`updated_at` timestamps** for accurate
  historical reporting.
- **No reconciliation pass needed for stock.** We're importing products.status
  and spare_parts.quantity as their *already-current* values from the old system
  (not replaying transaction history), so they're already ground truth as of
  export time.
- **Import order** (respects foreign keys): customers → vendors → products →
  spare_parts → job_sheets (with invoice_id left NULL) → invoices →
  invoice_items → **update** job_sheets.invoice_id (second pass) → quotations →
  quotation_items → job_sheet_parts → vendor_purchases → vendor_purchase_items →
  vendor_purchase_payments → expenses.

---

## customers (NEW table — built by deduplication, not a direct source table)

Built from the union of `invoices`, `job_sheets`, and `quotations`'
customer_name/customer_phone/customer_address/customer_gst columns (88 rows
total across all three).

- Normalize phone: strip all non-digits; if >10 digits remain, keep the last 10
  (strips a leading `+91`/`91` country code).
- Group by normalized phone. 50 distinct real customers found this way.
- For each group: `name` = most common spelling, `address`/`gst_number` = most
  recently-seen non-null value, `notes` = null unless flagged below.
- New `id` = freshly generated UUID (no source ID exists). Single `tenant_id`
  (look up the real tenant id at runtime — don't hardcode). `created_at` =
  earliest occurrence across all three source tables.

**Special cases (confirmed with the shop owner):**
- Phone `8310791265` appears under both "Naveen" and "Pavan G" — genuinely two
  different people. Import the **earlier-dated** occurrence as-is with the real
  number. Import the later one with phone `DUPLICATE-8310791265-PAVANG` and
  `notes = 'Shared phone number with another customer record in the old
  system — needs manual correction of the real number.'`
- "Ingen IT Solutions" (one invoice, no phone recorded at all) — import with
  phone `NOPHONE-INGEN-001` and `notes = 'No phone number was on file in the
  old system — please update with the real number when known.'`

**Validation**: 88 source rows → 50 unique phones, only 1 name conflict, only 3
phones with multiple different addresses (normal — customer moved, or address
recorded with varying detail across visits). Data is clean overall.

---

## vendors (direct import, reuse `id`)

`id, name, contact_phone, contact_email, gstin, address, notes, created_at,
updated_at` → same columns. `tenant_id` → new tenant's id. Drop `user_id`,
`created_by` (old auth references, meaningless in the new auth system).

## products (direct import, reuse `id`)

Same-name columns carry over directly: `name, category, brand, serial_imei,
ram, storage, condition, purchase_price, selling_price, battery_health,
warranty_expiry, notes, image_url, created_at, updated_at, device_age_value,
device_age_unit, has_original_bill, has_original_box, description, hsn_code,
vendor_id (reused), vendor_invoice_no, purchase_date`.

- `status`: `'In Stock'` → `'available'`, `'Sold'` → `'sold'`.
- Drop `user_id`, `created_by`, `is_public`, `video_url`, `key_highlights`,
  `is_global_variant` (all either dropped features or auth references).

**Validation**: 0 orphaned vendor_id references. 0 rows missing name, purchase
price, or selling price. 80 In Stock / 32 Sold.

## spare_parts (direct import, reuse `id`)

`name, part_number, category, quantity, reorder_level, purchase_price,
selling_price, hsn_code, vendor_id (reused), vendor_invoice_no, purchase_date,
notes, created_at, updated_at, tracks_serial` carry over directly.
`compatible_models`/`serial_numbers` are JSON-array-as-text in the source
(e.g. `'["Lenovo Thinkpad"]'`) — parse and store as real Postgres arrays.
`description` = null (column didn't exist in the old spare_parts table). Drop
`user_id`, `created_by`.

**Validation**: 0 orphaned vendor_id. All 25 rows have `tracks_serial = false`
(never actually used), so `serial_numbers` is `[]` for every row.

## job_sheets (direct import, reuse `id` — reshaped, no money fields)

`job_number` (keep exact, e.g. "OG-JOB-00034"), `device_name, device_brand,
device_imei, device_color, reported_problem, physical_condition,
accessories_received, technician_notes, estimated_ready_date, delivered_at,
created_at, updated_at` carry over directly.

- `status`: `'Delivered'` → `'delivered'`, `'Pending'` → `'in_progress'`
  (confirmed default — 3 rows, owner will adjust individually post-import if
  any are actually further along).
- `customer_id`: **new** — look up via normalized-phone match against the
  customers table just built.
- `invoice_id`: reused directly (job_sheet keeps its old linked invoice's id,
  which will exist since invoices are imported with the same ids too) — but
  insert job_sheets FIRST with this left NULL, then UPDATE it in a second pass
  after invoices are imported (mirrors how the live schema itself handles this
  circular reference).
- `device_password` = null (new field, no historical equivalent).
- **Drop entirely** (money fields that don't exist in the new schema by
  design): `customer_name/phone/address/gst` (superseded by `customer_id`),
  `labor_charge, labor_sac_code, parts_total, discount, total_amount` — this
  data isn't lost, it's already being imported properly on the *linked
  invoice's* line items instead.
- Drop `user_id, created_by, last_modified_by, last_modified_at`.

**Validation**: 0 orphaned links either direction, 0 bidirectional mismatches
across all 36 rows. 33 Delivered / 3 Pending. All 3 Pending have no invoice_id
(genuinely still-open jobs, consistent with the status).

## job_sheet_parts (direct import, reuse `id` — reference only)

`job_sheet_id (reused), spare_part_id (reused, if set), part_name, quantity`
only. Drop `hsn_code, unit_price, total_price, description` — the new schema's
job_sheet_parts deliberately carries no pricing.

---

## invoices (direct import, reuse `id` — the most involved transform)

**GST math — validated three independent ways, not guessed:**
1. Cross-referenced the `ledger_entries` "GST Payable" account (12 entries)
   against invoices — matches `final_price ÷ 1.18` to the penny on every row.
2. Discovered `labor_charge` is *always* duplicated as a "Labor / Service
   Charges" line in `invoice_items` (confirmed on all 20 invoices that have a
   labor charge — zero exceptions) — so it must NOT be added again on top of
   the items sum, or it double-counts.
3. After correcting for that, `sum(invoice_items.total_price) − discount`
   matches `final_price` **exactly** (0.00 difference) on all 39 non-GST
   invoices, and matches the ledger-derived GST split on all 12 GST invoices.

**Formula used for every invoice:**
```
if is_tax_invoice = true:
  taxable_value = round(final_price / 1.18, 2)
  cgst_amount   = round((final_price - taxable_value) / 2, 2)
  sgst_amount   = cgst_amount
else:
  taxable_value = final_price
  cgst_amount   = 0
  sgst_amount   = 0
```

**Column mapping:**
- `invoice_number`: keep exact original string (e.g. "OG-GST-00003").
- `invoice_series`: `is_tax_invoice` true → `'gst'`, false → `'non_gst'`.
- `customer_id`: new, phone-matched lookup (Ingen IT Solutions → its
  placeholder customer).
- `job_sheet_id`: reused directly (job_sheets already imported by this point).
- `customer_gst, eway_bill, discount, payment_status (lowercase: 'Paid'→'paid',
  'Unpaid'→'unpaid'), amount_paid, created_at, final_price`: carry over as-is.
- `labor_charge` = **0**, `labor_sac_code` = null — deliberately zeroed since
  the labor amount is already fully represented as a line item in
  invoice_items (see math note above); setting it again here would double it.
- `void`: `status = 'voided'` → true (exactly 1 row: "OG-GST-00011").
  `void_reason = 'Voided in the previous system (no reason was recorded).'`
- `superseded` = false, `converted_from_invoice_id` = null (neither concept
  existed in the old app).
- Drop `user_id, product_id, item_name, serial_imei, ram, storage,
  original_price` (legacy flat single-item columns, fully superseded by the
  properly-imported invoice_items), `created_by, last_modified_by,
  last_modified_at`.

## invoice_items (direct import, reuse `id`)

`invoice_id (reused), item_type, product_id (reused), spare_part_id (reused),
item_name, description, hsn_code, serial_imei, ram, storage, quantity,
unit_price, cost_price, total_price, created_at` carry over directly.
`warranty_days` and `warranty_notes` = null (new columns, no historical data).

---

## quotations (direct import — only 1 row, reuse `id`)

`quotation_number` (keep "OG-QT-00003"), `labor_charge` (already 0 in source,
no double-count issue here), `labor_sac_code, discount, subtotal, total,
valid_until, created_at, updated_at` carry over directly. `invoice_series`:
`is_tax_invoice = false` → `'non_gst'`. `customer_id`: new, phone-matched
(Kiran, 7899277284). `converted_invoice_id` = null (never converted).

**Needs verification before import**: old `status = 'Draft'` — check the
actual status values `Quotations.tsx`/`QuotationDetail.tsx` expect for their
badge styling (likely lowercase `'pending'`), and normalize to match rather
than importing the literal string "Draft".

## quotation_items (direct import — 1 row, reuse `id`)

Direct column-for-column carry-over, same shape as invoice_items minus the
warranty columns (which don't exist on quotation_items by design).

---

## credit_notes / vendor_debit_notes

**Nothing to import** — both are 0 rows in the old system.

## vendor_purchases (direct import, reuse `id`)

`purchase_number` (keep exact), `vendor_id (reused), supplier_invoice_no,
purchase_date, total_taxable_value, total_gst, grand_total, notes, created_at,
updated_at` carry over directly. `payment_status`: `'Paid'` → `'paid'`,
`'Pending'` → `'unpaid'`.

**Needs verification before import**: old `purchase_kind` values are
`'inventory'`/`'expense'` — check the actual values
`VendorPurchaseNew.tsx`/`create_vendor_purchase` expect (likely something like
`'stock_in_trade'`/`'office_expense'`) and map accordingly rather than
importing the old literal strings.

## vendor_purchase_items (direct import, reuse `id`)

Direct carry-over for `purchase_id (reused), item_type, item_name, brand,
category, hsn_code, description, ram, storage, condition, unit_price,
quantity, gst_rate, taxable_value, gst_amount, total, spare_part_id (reused),
created_at`. `serials`/`product_ids` are JSON-array-as-text in source — parse
into real arrays (the UUIDs inside `product_ids` are already valid since
products were imported with matching ids).

## vendor_purchase_payments (direct import, reuse `id`)

`purchase_id (reused), vendor_id (reused), amount, payment_date, mode,
reference_no, notes, created_at` carry over directly. Drop `user_id,
created_by`.

## expenses (direct import, reuse `id`)

`description, amount, expense_date, created_at` carry over directly.
`category` mapping (only 6 rows, easy to hand-correct if any are wrong):
`'Rent'` → `'rent'`, `'Staff Salary'` → `'salaries'`, `'Electricity'` →
`'utilities'`, `'Internet'` → `'utilities'`, `'Repairs'` → `'supplies'`.

## ledger_entries

**Not imported as rows.** Used only as a validation source for the invoice GST
math above. Consistent with the earlier decision to leave the Ledger tab
dormant for now.
