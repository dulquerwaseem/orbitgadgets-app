#!/usr/bin/env node
'use strict'

// One-time data migration from the old Orbit Gadgets system into the new
// schema. See migration/migration-plan.md for the full field-mapping spec,
// and migration/VERIFICATION-NOTES.md for corrections made after checking
// that spec against the real frontend/backend code and the raw CSVs:
//   1. Quotations "Draft" status -> 'pending'.
//   2. vendor_purchases.purchase_kind 'inventory'/'expense' -> 'stock_in_trade'/
//      'office_expense'.
//   3. invoice_items.item_type 'inventory'/'spare_part'/'manual' -> 'product'/
//      'spare'/'custom' ('service' unchanged) -- the live check constraint
//      only allows ('product','spare','service','custom').
//   4. vendor_purchase_items.item_type 'inventory'/'spare_part'/'expense' ->
//      'product'/'spare'/'other' (same shape of problem as #3, applied here
//      for the first time in this full run).
//   5. "Ingen IT Solutions" customer dedup unified under its real phone
//      (962000998) instead of the spec's NOPHONE-INGEN-001 placeholder.
//
// Usage:
//   node run-import.js --sample   (default; customers/job_sheets/invoices/
//                                   invoice_items only, see SAMPLE_INVOICE_NUMBERS)
//   node run-import.js --full     (every table, every row)
//
// Import order (respects foreign keys, including the job_sheets/invoices
// circular reference via a two-pass insert+backfill):
//   customers -> vendors -> products -> spare_parts -> job_sheets (invoice_id
//   null) -> invoices -> invoice_items -> job_sheets.invoice_id backfill ->
//   quotations -> quotation_items -> job_sheet_parts -> vendor_purchases ->
//   vendor_purchase_items -> vendor_purchase_payments -> expenses.
//
// The service role key is read from <repo root>/.env.migration (gitignored,
// loaded via dotenv) as SUPABASE_SERVICE_ROLE_KEY — never written into any
// committed file.

const fs = require('fs')
const path = require('path')
const { parse } = require('csv-parse/sync')
const { createClient } = require('@supabase/supabase-js')

const REPO_ROOT = path.join(__dirname, '..')
const DATA_DIR = path.join(__dirname, 'data')
const FULL_RUN = process.argv.includes('--full')

require('dotenv').config({ path: path.join(REPO_ROOT, '.env.migration') })

// ---------------------------------------------------------------------------
// Client setup
// ---------------------------------------------------------------------------
function readSupabaseUrl() {
  const envPath = path.join(REPO_ROOT, '.env')
  const content = fs.readFileSync(envPath, 'utf8')
  const match = content.match(/^VITE_SUPABASE_URL=(.*)$/m)
  if (!match || !match[1].trim()) {
    throw new Error('Could not find VITE_SUPABASE_URL in the repo root .env')
  }
  return match[1].trim()
}

const SUPABASE_URL = readSupabaseUrl()
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY.')
  console.error(`Add it to ${path.join(REPO_ROOT, '.env.migration')} as:`)
  console.error('  SUPABASE_SERVICE_ROLE_KEY=your-key-here')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ---------------------------------------------------------------------------
// CSV loading
// ---------------------------------------------------------------------------
function loadCsv(prefix) {
  const file = fs.readdirSync(DATA_DIR).find((f) => f.startsWith(`${prefix}-export-`))
  if (!file) throw new Error(`No CSV found for prefix "${prefix}"`)
  const content = fs.readFileSync(path.join(DATA_DIR, file), 'utf8')
  return parse(content, { delimiter: ';', columns: true, bom: true })
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function normalizePhone(raw) {
  const digits = (raw || '').replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

function toBool(v) {
  return v === 'true' || v === 'TRUE' || v === true
}

function toNum(v, fallback = 0) {
  if (v === undefined || v === null || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function toNumOrNull(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toIntOrNull(v) {
  const n = toNumOrNull(v)
  return n === null ? null : Math.round(n)
}

function nullIfEmpty(v) {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

// Same as nullIfEmpty, but for NOT NULL columns that have a sensible DB
// default (e.g. `purchase_date date not null default current_date`) --
// returns undefined instead of null so the key is dropped from the insert
// payload entirely, letting Postgres apply its default rather than erroring.
function dateOrDefault(v) {
  return nullIfEmpty(v) || undefined
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function parseJsonArray(v) {
  if (v === undefined || v === null || String(v).trim() === '') return []
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// item_type mapping shared by invoice_items/quotation_items. Includes
// identity entries for the already-valid new vocabulary too, so it's safe
// to apply even to rows that (like the one quotation_item) already use the
// new values.
const ITEM_TYPE_MAP = {
  inventory: 'product',
  spare_part: 'spare',
  service: 'service',
  manual: 'custom',
  product: 'product',
  spare: 'spare',
  custom: 'custom',
}

// vendor_purchase_items uses a different old vocabulary than invoice_items
// ('expense' instead of 'manual'), and a different new target vocabulary
// ('other' instead of 'custom') -- kept as a separate map rather than
// overloading ITEM_TYPE_MAP.
const VENDOR_PURCHASE_ITEM_TYPE_MAP = {
  inventory: 'product',
  spare_part: 'spare',
  expense: 'other',
  product: 'product',
  spare: 'spare',
  other: 'other',
}

const JOB_SHEET_STATUS_MAP = {
  Delivered: 'delivered',
  Pending: 'in_progress',
}

const QUOTATION_STATUS_MAP = {
  Draft: 'pending',
}

const PAYMENT_STATUS_MAP = {
  Paid: 'paid',
  Unpaid: 'unpaid',
}

const PRODUCT_STATUS_MAP = {
  'In Stock': 'available',
  Sold: 'sold',
}

const VENDOR_PURCHASE_KIND_MAP = {
  inventory: 'stock_in_trade',
  expense: 'office_expense',
}

const VENDOR_PURCHASE_PAYMENT_MAP = {
  Paid: 'paid',
  Pending: 'unpaid',
}

const EXPENSE_CATEGORY_MAP = {
  Rent: 'rent',
  'Staff Salary': 'salaries',
  Electricity: 'utilities',
  Internet: 'utilities',
  Repairs: 'supplies',
}

function mapOrThrow(map, value, label) {
  const mapped = map[value]
  if (mapped === undefined) throw new Error(`Unmapped ${label}: ${JSON.stringify(value)}`)
  return mapped
}

// ---------------------------------------------------------------------------
// Customer dedup
//
// Built from the union of invoices/job_sheets/quotations customer_* columns.
// Two hand-confirmed special cases, both resolved by adjusting the row's
// *effective* phone before generic phone-grouping runs, so the rest of the
// algorithm (most-common name, most-recent non-null address/gst, earliest
// created_at) stays uniform:
//
//   - Naveen (early) / Pavan G (late) both used 8310791265. Split by date
//     instead of merging: Pavan G's later occurrence gets a placeholder
//     phone + note.
//   - "Ingen IT Solutions" (blank phone, one invoice) is the same company as
//     "INGEN IT SOLUTIONS" (phone 962000998, one invoice + one job sheet) --
//     confirmed same name/address. Force the blank-phone row's effective
//     phone to 962000998 so it joins that group naturally, instead of the
//     spec's NOPHONE-INGEN-001 placeholder.
// ---------------------------------------------------------------------------
const SHARED_PHONE_NAVEEN_PAVAN = '8310791265'

function effectivePhone(name, rawPhone) {
  const norm = normalizePhone(rawPhone)
  if (norm === '' && /ingen it solutions/i.test(name || '')) {
    return '962000998'
  }
  return norm
}

function buildCustomers({ invoices, jobSheets, quotations }, tenantId) {
  const rows = []
  for (const r of invoices) {
    rows.push({
      kind: 'invoice',
      key: r.invoice_number,
      name: r.customer_name,
      rawPhone: r.customer_phone,
      address: r.customer_address,
      gst: r.customer_gst,
      createdAt: r.created_at,
    })
  }
  for (const r of jobSheets) {
    rows.push({
      kind: 'job_sheet',
      key: r.job_number,
      name: r.customer_name,
      rawPhone: r.customer_phone,
      address: r.customer_address,
      gst: r.customer_gst,
      createdAt: r.created_at,
    })
  }
  for (const r of quotations) {
    rows.push({
      kind: 'quotation',
      key: r.quotation_number,
      name: r.customer_name,
      rawPhone: r.customer_phone,
      address: r.customer_address,
      gst: r.customer_gst,
      createdAt: r.created_at,
    })
  }

  for (const r of rows) {
    r.phone = effectivePhone(r.name, r.rawPhone)
  }

  const groups = new Map() // groupKey -> rows[]
  for (const r of rows) {
    const key = r.phone === '' ? `__blank__${r.name}` : r.phone
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  const customers = []
  const rowIdToCustomer = new Map() // `${kind}:${key}` -> customer object

  function finalizeGroup(groupRows, phone, notes) {
    const sorted = [...groupRows].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    const nameCounts = new Map()
    for (const r of sorted) nameCounts.set(r.name, (nameCounts.get(r.name) || 0) + 1)
    let bestName = sorted[0].name
    let bestCount = 0
    for (const [name, count] of nameCounts) {
      if (count > bestCount) {
        bestName = name
        bestCount = count
      }
    }

    let address = null
    let gst = null
    for (const r of sorted) {
      const a = nullIfEmpty(r.address)
      const g = nullIfEmpty(r.gst)
      if (a) address = a
      if (g) gst = g
    }

    const customer = {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      name: bestName,
      phone,
      address,
      gst_number: gst,
      notes,
      created_at: sorted[0].createdAt,
    }
    customers.push(customer)
    for (const r of sorted) {
      rowIdToCustomer.set(`${r.kind}:${r.key}`, customer)
    }
    return customer
  }

  for (const [key, groupRows] of groups) {
    if (key === SHARED_PHONE_NAVEEN_PAVAN) {
      const sorted = [...groupRows].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      const earliestName = sorted[0].name
      const earlyGroup = sorted.filter((r) => r.name === earliestName)
      const lateGroup = sorted.filter((r) => r.name !== earliestName)

      finalizeGroup(earlyGroup, SHARED_PHONE_NAVEEN_PAVAN, null)
      if (lateGroup.length > 0) {
        finalizeGroup(
          lateGroup,
          'DUPLICATE-8310791265-PAVANG',
          'Shared phone number with another customer record in the old system — needs manual correction of the real number.',
        )
      }
      continue
    }

    finalizeGroup(groupRows, key.startsWith('__blank__') ? '' : key, null)
  }

  return { customers, rowIdToCustomer }
}

// ---------------------------------------------------------------------------
// Insert helper: fail fast, but with a clear per-table message.
// ---------------------------------------------------------------------------
async function insertAll(table, rows) {
  if (rows.length === 0) return
  const { error } = await supabase.from(table).insert(rows)
  if (error) throw new Error(`${table} insert failed: ${error.message}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Mode: ${FULL_RUN ? 'FULL IMPORT' : 'SAMPLE (5 customers-scope, 5 invoices, 3 pending job sheets)'}`)

  const { data: tenants, error: tenantError } = await supabase.from('tenants').select('id, name')
  if (tenantError) throw tenantError
  if (!tenants || tenants.length !== 1) {
    throw new Error(
      `Expected exactly 1 tenant, found ${tenants ? tenants.length : 0}. ` +
        `Tenants: ${JSON.stringify(tenants)}. Refusing to guess which one to use.`,
    )
  }
  const tenantId = tenants[0].id
  console.log(`Tenant: ${tenants[0].name} (${tenantId})`)

  const invoicesCsv = loadCsv('invoices')
  const invoiceItemsCsv = loadCsv('invoice_items')
  const jobSheetsCsv = loadCsv('job_sheets')
  const quotationsCsv = loadCsv('quotations')

  const counts = [] // { table, inserted, sourceRows }

  const { customers: allCustomers, rowIdToCustomer } = buildCustomers(
    { invoices: invoicesCsv, jobSheets: jobSheetsCsv, quotations: quotationsCsv },
    tenantId,
  )
  console.log(
    `Computed ${allCustomers.length} deduplicated customers from ${invoicesCsv.length + jobSheetsCsv.length + quotationsCsv.length} source rows.`,
  )

  // -------------------------------------------------------------------------
  // Scope selection (customers/job_sheets/invoices/invoice_items only --
  // every other table is full-run-only, see below)
  // -------------------------------------------------------------------------
  let scopedInvoices, scopedJobSheets

  if (FULL_RUN) {
    scopedInvoices = invoicesCsv
    scopedJobSheets = jobSheetsCsv
  } else {
    const SAMPLE_INVOICE_NUMBERS = ['OG-INV-00002', 'OG-INV-00014', 'OG-INV-00007', 'OG-GST-00001', 'OG-GST-00003']
    scopedInvoices = invoicesCsv.filter((r) => SAMPLE_INVOICE_NUMBERS.includes(r.invoice_number))
    scopedJobSheets = jobSheetsCsv.filter((r) => r.status === 'Pending')

    if (scopedInvoices.length !== SAMPLE_INVOICE_NUMBERS.length) {
      throw new Error(`Expected ${SAMPLE_INVOICE_NUMBERS.length} sample invoices, found ${scopedInvoices.length}`)
    }
  }

  const jobSheetIdsInScope = new Set(scopedJobSheets.map((r) => r.id))

  const neededCustomerIds = new Set()
  for (const r of scopedInvoices) {
    const c = rowIdToCustomer.get(`invoice:${r.invoice_number}`)
    if (c) neededCustomerIds.add(c.id)
  }
  for (const r of scopedJobSheets) {
    const c = rowIdToCustomer.get(`job_sheet:${r.job_number}`)
    if (c) neededCustomerIds.add(c.id)
  }
  const scopedCustomers = FULL_RUN ? allCustomers : allCustomers.filter((c) => neededCustomerIds.has(c.id))

  const scopedInvoiceIds = new Set(scopedInvoices.map((r) => r.id))
  const scopedItems = invoiceItemsCsv.filter((r) => scopedInvoiceIds.has(r.invoice_id))

  // -------------------------------------------------------------------------
  // 1. customers
  // -------------------------------------------------------------------------
  const customerRows = scopedCustomers.map((c) => ({
    id: c.id,
    tenant_id: c.tenant_id,
    name: c.name,
    phone: c.phone,
    address: c.address,
    gst_number: c.gst_number,
    notes: c.notes,
    created_at: c.created_at,
  }))

  console.log(`\nInserting ${customerRows.length} customers...`)
  await insertAll('customers', customerRows)
  counts.push({ table: 'customers', inserted: customerRows.length, sourceRows: allCustomers.length })

  // -------------------------------------------------------------------------
  // 2. vendors (full run only)
  // -------------------------------------------------------------------------
  let vendorIds = new Set()
  if (FULL_RUN) {
    const vendorsCsv = loadCsv('vendors')
    const vendorRows = vendorsCsv.map((r) => ({
      id: r.id,
      tenant_id: tenantId,
      name: r.name,
      contact_phone: nullIfEmpty(r.contact_phone),
      contact_email: nullIfEmpty(r.contact_email),
      gstin: nullIfEmpty(r.gstin),
      address: nullIfEmpty(r.address),
      notes: nullIfEmpty(r.notes),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }))
    console.log(`Inserting ${vendorRows.length} vendors...`)
    await insertAll('vendors', vendorRows)
    counts.push({ table: 'vendors', inserted: vendorRows.length, sourceRows: vendorsCsv.length })
    vendorIds = new Set(vendorRows.map((r) => r.id))
  }

  // -------------------------------------------------------------------------
  // 3. products (full run only)
  // -------------------------------------------------------------------------
  let productIds = new Set()
  if (FULL_RUN) {
    const productsCsv = loadCsv('products')
    const productRows = productsCsv.map((r) => ({
      id: r.id,
      tenant_id: tenantId,
      name: r.name,
      category: nullIfEmpty(r.category),
      brand: nullIfEmpty(r.brand),
      serial_imei: nullIfEmpty(r.serial_imei),
      ram: nullIfEmpty(r.ram),
      storage: nullIfEmpty(r.storage),
      condition: nullIfEmpty(r.condition),
      purchase_price: toNumOrNull(r.purchase_price),
      selling_price: toNumOrNull(r.selling_price),
      battery_health: toIntOrNull(r.battery_health),
      warranty_expiry: nullIfEmpty(r.warranty_expiry),
      // status is nullable in the schema but every source row has one of the
      // two known values -- fail loudly rather than silently importing null.
      status: mapOrThrow(PRODUCT_STATUS_MAP, r.status, 'products.status'),
      image_url: null,
      video_url: null,
      key_highlights: null,
      description: nullIfEmpty(r.description),
      notes: nullIfEmpty(r.notes),
      device_age_value: toNumOrNull(r.device_age_value),
      device_age_unit: nullIfEmpty(r.device_age_unit),
      has_original_bill: toBool(r.has_original_bill),
      has_original_box: toBool(r.has_original_box),
      hsn_code: nullIfEmpty(r.hsn_code),
      vendor_id: nullIfEmpty(r.vendor_id) && vendorIds.has(r.vendor_id) ? r.vendor_id : null,
      vendor_invoice_no: nullIfEmpty(r.vendor_invoice_no),
      purchase_date: nullIfEmpty(r.purchase_date),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }))
    console.log(`Inserting ${productRows.length} products...`)
    await insertAll('products', productRows)
    counts.push({ table: 'products', inserted: productRows.length, sourceRows: productsCsv.length })
    productIds = new Set(productRows.map((r) => r.id))
  }

  // -------------------------------------------------------------------------
  // 4. spare_parts (full run only)
  // -------------------------------------------------------------------------
  let sparePartIds = new Set()
  if (FULL_RUN) {
    const sparePartsCsv = loadCsv('spare_parts')
    const sparePartRows = sparePartsCsv.map((r) => ({
      id: r.id,
      tenant_id: tenantId,
      name: r.name,
      part_number: nullIfEmpty(r.part_number),
      category: nullIfEmpty(r.category),
      compatible_models: parseJsonArray(r.compatible_models),
      quantity: toIntOrNull(r.quantity) ?? 0,
      reorder_level: toIntOrNull(r.reorder_level),
      purchase_price: toNumOrNull(r.purchase_price),
      selling_price: toNumOrNull(r.selling_price),
      hsn_code: nullIfEmpty(r.hsn_code),
      vendor_id: nullIfEmpty(r.vendor_id) && vendorIds.has(r.vendor_id) ? r.vendor_id : null,
      vendor_invoice_no: nullIfEmpty(r.vendor_invoice_no),
      purchase_date: nullIfEmpty(r.purchase_date),
      tracks_serial: toBool(r.tracks_serial),
      serial_numbers: parseJsonArray(r.serial_numbers),
      notes: nullIfEmpty(r.notes),
      created_at: r.created_at,
      updated_at: r.updated_at,
    }))
    console.log(`Inserting ${sparePartRows.length} spare parts...`)
    await insertAll('spare_parts', sparePartRows)
    counts.push({ table: 'spare_parts', inserted: sparePartRows.length, sourceRows: sparePartsCsv.length })
    sparePartIds = new Set(sparePartRows.map((r) => r.id))
  }

  // -------------------------------------------------------------------------
  // 5. job_sheets, pass 1 (invoice_id left null)
  // -------------------------------------------------------------------------
  const jobSheetRows = scopedJobSheets.map((r) => {
    const customer = rowIdToCustomer.get(`job_sheet:${r.job_number}`)
    return {
      id: r.id,
      tenant_id: tenantId,
      job_number: r.job_number,
      status: mapOrThrow(JOB_SHEET_STATUS_MAP, r.status, 'job_sheets.status'),
      customer_id: customer ? customer.id : null,
      device_name: nullIfEmpty(r.device_name),
      device_brand: nullIfEmpty(r.device_brand),
      device_imei: nullIfEmpty(r.device_imei),
      device_color: nullIfEmpty(r.device_color),
      device_password: null,
      reported_problem: nullIfEmpty(r.reported_problem),
      physical_condition: nullIfEmpty(r.physical_condition),
      accessories_received: nullIfEmpty(r.accessories_received),
      technician_notes: nullIfEmpty(r.technician_notes),
      estimated_ready_date: nullIfEmpty(r.estimated_ready_date),
      delivered_at: nullIfEmpty(r.delivered_at),
      invoice_id: null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }
  })

  console.log(`Inserting ${jobSheetRows.length} job sheets (invoice_id left null for now)...`)
  await insertAll('job_sheets', jobSheetRows)
  counts.push({ table: 'job_sheets', inserted: jobSheetRows.length, sourceRows: jobSheetsCsv.length })

  // -------------------------------------------------------------------------
  // 6. invoices
  // -------------------------------------------------------------------------
  let nulledJobSheetLinks = 0
  const invoiceRows = scopedInvoices.map((r) => {
    const customer = rowIdToCustomer.get(`invoice:${r.invoice_number}`)
    const finalPrice = toNum(r.final_price)
    const isTaxInvoice = toBool(r.is_tax_invoice)

    let taxableValue, cgstAmount, sgstAmount
    if (isTaxInvoice) {
      taxableValue = round2(finalPrice / 1.18)
      cgstAmount = round2((finalPrice - taxableValue) / 2)
      sgstAmount = cgstAmount
    } else {
      taxableValue = finalPrice
      cgstAmount = 0
      sgstAmount = 0
    }

    const rawJobSheetId = nullIfEmpty(r.job_sheet_id)
    let jobSheetId = rawJobSheetId
    if (jobSheetId && !jobSheetIdsInScope.has(jobSheetId)) {
      nulledJobSheetLinks += 1
      jobSheetId = null
    }

    const isVoided = r.status === 'voided'

    return {
      id: r.id,
      tenant_id: tenantId,
      invoice_number: r.invoice_number,
      invoice_series: isTaxInvoice ? 'gst' : 'non_gst',
      customer_id: customer ? customer.id : null,
      job_sheet_id: jobSheetId,
      customer_gst: nullIfEmpty(r.customer_gst),
      eway_bill: nullIfEmpty(r.eway_bill),
      discount: toNum(r.discount),
      taxable_value: taxableValue,
      cgst_amount: cgstAmount,
      sgst_amount: sgstAmount,
      final_price: finalPrice,
      labor_charge: 0,
      labor_sac_code: null,
      payment_status: mapOrThrow(PAYMENT_STATUS_MAP, r.payment_status, 'invoices.payment_status'),
      amount_paid: toNum(r.amount_paid),
      converted_from_invoice_id: null,
      superseded: false,
      void: isVoided,
      void_reason: isVoided ? 'Voided in the previous system (no reason was recorded).' : null,
      created_at: r.created_at,
    }
  })

  console.log(`Inserting ${invoiceRows.length} invoices (${nulledJobSheetLinks} job_sheet_id links deferred)...`)
  await insertAll('invoices', invoiceRows)
  counts.push({ table: 'invoices', inserted: invoiceRows.length, sourceRows: invoicesCsv.length })
  const invoiceIds = new Set(invoiceRows.map((r) => r.id))

  // -------------------------------------------------------------------------
  // 7. invoice_items
  // -------------------------------------------------------------------------
  let nulledProductLinks = 0
  let nulledSparePartLinks = 0
  const itemRows = scopedItems.map((r) => {
    const productId = nullIfEmpty(r.product_id)
    const sparePartId = nullIfEmpty(r.spare_part_id)
    const productInScope = productId && productIds.has(productId)
    const sparePartInScope = sparePartId && sparePartIds.has(sparePartId)
    if (productId && !productInScope) nulledProductLinks += 1
    if (sparePartId && !sparePartInScope) nulledSparePartLinks += 1

    return {
      id: r.id,
      invoice_id: r.invoice_id,
      item_type: mapOrThrow(ITEM_TYPE_MAP, r.item_type, 'invoice_items.item_type'),
      product_id: productInScope ? productId : null,
      spare_part_id: sparePartInScope ? sparePartId : null,
      item_name: r.item_name,
      description: nullIfEmpty(r.description),
      hsn_code: nullIfEmpty(r.hsn_code),
      serial_imei: nullIfEmpty(r.serial_imei),
      ram: nullIfEmpty(r.ram),
      storage: nullIfEmpty(r.storage),
      quantity: toNum(r.quantity, 1),
      unit_price: toNum(r.unit_price),
      cost_price: toNumOrNull(r.cost_price),
      total_price: toNum(r.total_price),
      warranty_days: null,
      warranty_notes: null,
      created_at: r.created_at,
    }
  })

  console.log(
    `Inserting ${itemRows.length} invoice items (${nulledProductLinks} product_id + ${nulledSparePartLinks} spare_part_id links deferred)...`,
  )
  await insertAll('invoice_items', itemRows)
  counts.push({ table: 'invoice_items', inserted: itemRows.length, sourceRows: invoiceItemsCsv.length })

  // -------------------------------------------------------------------------
  // 8. job_sheets, pass 2 -- backfill invoice_id
  // -------------------------------------------------------------------------
  let backfilled = 0
  for (const r of scopedJobSheets) {
    const invoiceId = nullIfEmpty(r.invoice_id)
    if (invoiceId && invoiceIds.has(invoiceId)) {
      const { error } = await supabase.from('job_sheets').update({ invoice_id: invoiceId }).eq('id', r.id)
      if (error) throw new Error(`job_sheets invoice_id backfill failed for ${r.job_number}: ${error.message}`)
      backfilled += 1
    }
  }
  console.log(`Backfilled invoice_id on ${backfilled} job sheet(s).`)

  // -------------------------------------------------------------------------
  // 9. quotations (full run only)
  // -------------------------------------------------------------------------
  let quotationIds = new Set()
  if (FULL_RUN) {
    const quotationRows = quotationsCsv.map((r) => {
      const customer = rowIdToCustomer.get(`quotation:${r.quotation_number}`)
      return {
        id: r.id,
        tenant_id: tenantId,
        quotation_number: r.quotation_number,
        customer_id: customer ? customer.id : null,
        invoice_series: toBool(r.is_tax_invoice) ? 'gst' : 'non_gst',
        labor_charge: toNum(r.labor_charge),
        labor_sac_code: nullIfEmpty(r.labor_sac_code),
        discount: toNum(r.discount),
        subtotal: toNum(r.subtotal),
        total: toNum(r.total),
        valid_until: nullIfEmpty(r.valid_until),
        notes: nullIfEmpty(r.notes),
        status: mapOrThrow(QUOTATION_STATUS_MAP, r.status, 'quotations.status'),
        converted_invoice_id: null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }
    })
    console.log(`Inserting ${quotationRows.length} quotations...`)
    await insertAll('quotations', quotationRows)
    counts.push({ table: 'quotations', inserted: quotationRows.length, sourceRows: quotationsCsv.length })
    quotationIds = new Set(quotationRows.map((r) => r.id))
  }

  // -------------------------------------------------------------------------
  // 10. quotation_items (full run only)
  // -------------------------------------------------------------------------
  if (FULL_RUN) {
    const quotationItemsCsv = loadCsv('quotation_items')
    let qiNulledProduct = 0
    let qiNulledSpare = 0
    const quotationItemRows = quotationItemsCsv
      .filter((r) => quotationIds.has(r.quotation_id))
      .map((r) => {
        const productId = nullIfEmpty(r.product_id)
        const sparePartId = nullIfEmpty(r.spare_part_id)
        const productInScope = productId && productIds.has(productId)
        const sparePartInScope = sparePartId && sparePartIds.has(sparePartId)
        if (productId && !productInScope) qiNulledProduct += 1
        if (sparePartId && !sparePartInScope) qiNulledSpare += 1

        return {
          id: r.id,
          quotation_id: r.quotation_id,
          item_type: mapOrThrow(ITEM_TYPE_MAP, r.item_type, 'quotation_items.item_type'),
          product_id: productInScope ? productId : null,
          spare_part_id: sparePartInScope ? sparePartId : null,
          item_name: r.item_name,
          description: nullIfEmpty(r.description),
          hsn_code: nullIfEmpty(r.hsn_code),
          serial_imei: nullIfEmpty(r.serial_imei),
          ram: nullIfEmpty(r.ram),
          storage: nullIfEmpty(r.storage),
          quantity: toNum(r.quantity, 1),
          unit_price: toNum(r.unit_price),
          cost_price: toNumOrNull(r.cost_price),
          total_price: toNum(r.total_price),
          created_at: r.created_at,
        }
      })
    console.log(
      `Inserting ${quotationItemRows.length} quotation items (${qiNulledProduct} product_id + ${qiNulledSpare} spare_part_id links deferred)...`,
    )
    await insertAll('quotation_items', quotationItemRows)
    counts.push({ table: 'quotation_items', inserted: quotationItemRows.length, sourceRows: quotationItemsCsv.length })
  }

  // -------------------------------------------------------------------------
  // 11. job_sheet_parts (full run only)
  // -------------------------------------------------------------------------
  if (FULL_RUN) {
    const jobSheetPartsCsv = loadCsv('job_sheet_parts')
    const jobSheetIds = new Set(jobSheetRows.map((r) => r.id))
    let jspNulledSpare = 0
    const jobSheetPartRows = jobSheetPartsCsv
      .filter((r) => jobSheetIds.has(r.job_sheet_id))
      .map((r) => {
        const sparePartId = nullIfEmpty(r.spare_part_id)
        const sparePartInScope = sparePartId && sparePartIds.has(sparePartId)
        if (sparePartId && !sparePartInScope) jspNulledSpare += 1
        return {
          id: r.id,
          job_sheet_id: r.job_sheet_id,
          spare_part_id: sparePartInScope ? sparePartId : null,
          part_name: r.part_name,
          quantity: toIntOrNull(r.quantity) ?? 1,
          created_at: r.created_at,
        }
      })
    console.log(`Inserting ${jobSheetPartRows.length} job sheet parts (${jspNulledSpare} spare_part_id links deferred)...`)
    await insertAll('job_sheet_parts', jobSheetPartRows)
    counts.push({ table: 'job_sheet_parts', inserted: jobSheetPartRows.length, sourceRows: jobSheetPartsCsv.length })
  }

  // -------------------------------------------------------------------------
  // 12. vendor_purchases (full run only)
  // -------------------------------------------------------------------------
  let vendorPurchaseIds = new Set()
  if (FULL_RUN) {
    const vendorPurchasesCsv = loadCsv('vendor_purchases')
    const vendorPurchaseRows = vendorPurchasesCsv.map((r) => {
      if (!vendorIds.has(r.vendor_id)) {
        throw new Error(`vendor_purchases ${r.purchase_number}: vendor_id ${r.vendor_id} was not imported`)
      }
      return {
        id: r.id,
        tenant_id: tenantId,
        purchase_number: r.purchase_number,
        vendor_id: r.vendor_id,
        supplier_invoice_no: nullIfEmpty(r.supplier_invoice_no),
        purchase_date: dateOrDefault(r.purchase_date),
        payment_status: mapOrThrow(VENDOR_PURCHASE_PAYMENT_MAP, r.payment_status, 'vendor_purchases.payment_status'),
        purchase_kind: mapOrThrow(VENDOR_PURCHASE_KIND_MAP, r.purchase_kind, 'vendor_purchases.purchase_kind'),
        total_taxable_value: toNum(r.total_taxable_value),
        total_gst: toNum(r.total_gst),
        grand_total: toNum(r.grand_total),
        notes: nullIfEmpty(r.notes),
        created_at: r.created_at,
        updated_at: r.updated_at,
      }
    })
    console.log(`Inserting ${vendorPurchaseRows.length} vendor purchases...`)
    await insertAll('vendor_purchases', vendorPurchaseRows)
    counts.push({ table: 'vendor_purchases', inserted: vendorPurchaseRows.length, sourceRows: vendorPurchasesCsv.length })
    vendorPurchaseIds = new Set(vendorPurchaseRows.map((r) => r.id))
  }

  // -------------------------------------------------------------------------
  // 13. vendor_purchase_items (full run only)
  // -------------------------------------------------------------------------
  if (FULL_RUN) {
    const vendorPurchaseItemsCsv = loadCsv('vendor_purchase_items')
    let vpiNulledSpare = 0
    let vpiDroppedProductIds = 0
    const vendorPurchaseItemRows = vendorPurchaseItemsCsv.map((r) => {
      if (!vendorPurchaseIds.has(r.purchase_id)) {
        throw new Error(`vendor_purchase_items ${r.id}: purchase_id ${r.purchase_id} was not imported`)
      }
      const sparePartId = nullIfEmpty(r.spare_part_id)
      const sparePartInScope = sparePartId && sparePartIds.has(sparePartId)
      if (sparePartId && !sparePartInScope) vpiNulledSpare += 1

      const rawProductIds = parseJsonArray(r.product_ids)
      const keptProductIds = rawProductIds.filter((id) => productIds.has(id))
      vpiDroppedProductIds += rawProductIds.length - keptProductIds.length

      return {
        id: r.id,
        purchase_id: r.purchase_id,
        item_type: mapOrThrow(VENDOR_PURCHASE_ITEM_TYPE_MAP, r.item_type, 'vendor_purchase_items.item_type'),
        item_name: r.item_name,
        brand: nullIfEmpty(r.brand),
        category: nullIfEmpty(r.category),
        hsn_code: nullIfEmpty(r.hsn_code),
        description: nullIfEmpty(r.description),
        ram: nullIfEmpty(r.ram),
        storage: nullIfEmpty(r.storage),
        condition: nullIfEmpty(r.condition),
        unit_price: toNum(r.unit_price),
        quantity: toNum(r.quantity, 1),
        gst_rate: toNum(r.gst_rate),
        taxable_value: toNum(r.taxable_value),
        gst_amount: toNum(r.gst_amount),
        total: toNum(r.total),
        serials: parseJsonArray(r.serials),
        product_ids: keptProductIds,
        spare_part_id: sparePartInScope ? sparePartId : null,
        created_at: r.created_at,
      }
    })
    console.log(
      `Inserting ${vendorPurchaseItemRows.length} vendor purchase items (${vpiNulledSpare} spare_part_id + ${vpiDroppedProductIds} product_ids entries deferred)...`,
    )
    await insertAll('vendor_purchase_items', vendorPurchaseItemRows)
    counts.push({
      table: 'vendor_purchase_items',
      inserted: vendorPurchaseItemRows.length,
      sourceRows: vendorPurchaseItemsCsv.length,
    })
  }

  // -------------------------------------------------------------------------
  // 14. vendor_purchase_payments (full run only)
  // -------------------------------------------------------------------------
  if (FULL_RUN) {
    const vendorPurchasePaymentsCsv = loadCsv('vendor_purchase_payments')
    const vendorPurchasePaymentRows = vendorPurchasePaymentsCsv.map((r) => {
      if (!vendorPurchaseIds.has(r.purchase_id)) {
        throw new Error(`vendor_purchase_payments ${r.id}: purchase_id ${r.purchase_id} was not imported`)
      }
      if (!vendorIds.has(r.vendor_id)) {
        throw new Error(`vendor_purchase_payments ${r.id}: vendor_id ${r.vendor_id} was not imported`)
      }
      return {
        id: r.id,
        purchase_id: r.purchase_id,
        vendor_id: r.vendor_id,
        amount: toNum(r.amount),
        payment_date: dateOrDefault(r.payment_date),
        mode: nullIfEmpty(r.mode),
        reference_no: nullIfEmpty(r.reference_no),
        notes: nullIfEmpty(r.notes),
        created_at: r.created_at,
      }
    })
    console.log(`Inserting ${vendorPurchasePaymentRows.length} vendor purchase payments...`)
    await insertAll('vendor_purchase_payments', vendorPurchasePaymentRows)
    counts.push({
      table: 'vendor_purchase_payments',
      inserted: vendorPurchasePaymentRows.length,
      sourceRows: vendorPurchasePaymentsCsv.length,
    })
  }

  // -------------------------------------------------------------------------
  // 15. expenses (full run only)
  // -------------------------------------------------------------------------
  if (FULL_RUN) {
    const expensesCsv = loadCsv('expenses')
    const expenseRows = expensesCsv.map((r) => ({
      id: r.id,
      tenant_id: tenantId,
      category: mapOrThrow(EXPENSE_CATEGORY_MAP, r.category, 'expenses.category'),
      description: nullIfEmpty(r.description),
      amount: toNum(r.amount),
      expense_date: dateOrDefault(r.expense_date),
      created_at: r.created_at,
    }))
    console.log(`Inserting ${expenseRows.length} expenses...`)
    await insertAll('expenses', expenseRows)
    counts.push({ table: 'expenses', inserted: expenseRows.length, sourceRows: expensesCsv.length })
  }

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------
  console.log('\n--- Count report ---')
  let anyMismatch = false
  for (const c of counts) {
    const ok = c.inserted === c.sourceRows
    if (!ok) anyMismatch = true
    console.log(`  ${ok ? '✓' : '✗'} ${c.table}: ${c.inserted} of ${c.sourceRows}`)
  }
  console.log(anyMismatch ? '\nMISMATCH DETECTED — see ✗ rows above.' : '\nAll tables fully imported, counts match source exactly.')
}

main().catch((err) => {
  console.error('\nMigration failed:', err.message)
  process.exit(1)
})
