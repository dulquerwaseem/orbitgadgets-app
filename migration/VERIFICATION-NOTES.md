# Pre-import verification notes

Findings from checking migration-plan.md against the real frontend/backend code
and the raw CSVs, before writing run-import.js. Four issues found — two were
the ones explicitly flagged as "needs verification", two more turned up during
data inspection.

## 1. Quotations status (flagged in spec)

`Quotations.tsx` / `QuotationDetail.tsx` only style two status values:
`'pending'` and `'converted'` (see `statusStyles` in both files). The old
system's `'Draft'` → **`'pending'`**.

## 2. Vendor purchase_kind (flagged in spec)

`VendorPurchaseNew.tsx`'s `purchaseKindOptions` and `create_vendor_purchase`'s
auto-linking logic only recognize `'stock_in_trade'` / `'office_expense'` /
`'capital_asset'`. Old values map: `'inventory'` → **`'stock_in_trade'`**,
`'expense'` → **`'office_expense'`**.

(Not exercised by the sample run — vendor_purchases isn't in scope yet.)

## 3. `_number_counters` table count — spec claim was wrong

The spec's vendor_purchases section didn't flag this, but you asked me to
check anyway: there are **5** `_number_counters` tables, not 4.
`vendor_purchase_number_counters` exists and `next_vendor_purchase_number()`
uses the exact same insert-or-increment pattern as the other four. It's not
"derived from MAX(purchase_number)" — that was a wrong guess in the spec.
Doesn't affect this script either way, since we insert original
`purchase_number` values directly and never call the RPC — just flagging that
the spec's stated reasoning was incorrect.

## 4. `invoice_items.item_type` — spec said "carries over directly", it doesn't

Not flagged in the spec at all, found while inspecting invoice_items.csv. The
live schema's check constraint only allows
`('product', 'spare', 'service', 'custom')`. The old data actually contains
`'inventory'` (33 rows), `'spare_part'` (20), `'service'` (20), `'manual'`
(4). Mapped: `inventory→product`, `spare_part→spare`, `service→service`,
`manual→custom`. Importing the literal old strings would have failed the
check constraint on ~57 of the 77 total invoice_items rows.

`vendor_purchase_items.item_type` has the same shape of problem (old values
`inventory`/`spare_part`/`expense`; the frontend only recognizes
`product`/`spare`/`other`) — not fixed yet since vendor_purchases isn't in
this run's scope, but it'll need the same treatment before the full import.

## 5. "Ingen IT Solutions" customer — spec's special case was incomplete

The spec said: *"'Ingen IT Solutions' (one invoice, no phone recorded at
all)"* and specified a `NOPHONE-INGEN-001` placeholder. Checking the raw data
found the same company appears **three times**, not once:

| Source | Name | Phone |
|---|---|---|
| Invoice OG-INV-00007 (2026-05-12) | "Ingen IT Solutions" | *(blank)* |
| Invoice OG-GST-00001 (2026-04-26) | "INGEN IT SOLUTIONS" | `962000998` |
| Job Sheet OG-JOB-00002 (Delivered) | "INGEN IT SOLUTIONS" | `962000998` |

Same name (modulo casing) and same address on all three. **Per your
decision**, all three are unified under the real phone `962000998`; the
`NOPHONE-INGEN-001` placeholder is not used. Confirmed this is the *only*
blank-phone row across all 88 source rows (invoices + job_sheets +
quotations), so this fix doesn't risk merging any unrelated blank-phone
customers together.

## Naveen / Pavan G — spec's special case checked out

Unlike the Ingen case, this one is accurate as written. Naveen appears twice
(invoice OG-INV-00002 + job sheet OG-JOB-00003, same day, same visit, phone
recorded as `\t+91 83107 91265`) and Pavan G appears once, later
(invoice OG-INV-00014, 2026-06-07, phone `8310791265`). Both normalize to the
same 10-digit phone. Implemented exactly as specified: Naveen (earlier) keeps
the real number, Pavan G (later) gets `DUPLICATE-8310791265-PAVANG` + the
notes text from the spec.
