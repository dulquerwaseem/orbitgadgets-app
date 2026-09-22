import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrencyExact, formatDate, formatLabel } from '../lib/format'
import PaymentsSection from '../components/vendorpurchase/PaymentsSection'
import DebitNotesSection from '../components/vendorpurchase/DebitNotesSection'
import AmendmentHistorySection from '../components/vendorpurchase/AmendmentHistorySection'
import PrintHeader from '../components/print/PrintHeader'
import PrintFooter from '../components/print/PrintFooter'
import Modal from '../components/Modal'

interface VendorPurchaseData {
  id: string
  vendor_id: string
  purchase_number: string
  supplier_invoice_no: string | null
  purchase_date: string
  payment_status: string
  amount_paid: number
  purchase_kind: string | null
  total_taxable_value: number
  total_gst: number
  grand_total: number
  round_off: boolean
  round_off_amount: number
  notes: string | null
  vendors: { name: string; gstin: string | null; contact_phone: string | null; contact_email: string | null } | null
}

interface VendorPurchaseItemRow {
  id: string
  item_type: string | null
  item_name: string
  brand: string | null
  category: string | null
  hsn_code: string | null
  description: string | null
  quantity: number
  unit_price: number
  gst_rate: number
  taxable_value: number
  gst_amount: number
  total: number
  serials: string[] | null
  product_ids: string[] | null
  spare_part_id: string | null
}

const paymentStatusStyles: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-600',
  partial: 'bg-amber-50 text-amber-600',
  unpaid: 'bg-red-50 text-red-500',
}

interface VendorOption {
  id: string
  name: string
}

export default function VendorPurchaseDetail() {
  const { id } = useParams<{ id: string }>()
  const { membership } = useAuth()
  const isAdmin = membership?.role === 'admin'

  const [purchase, setPurchase] = useState<VendorPurchaseData | null>(null)
  const [items, setItems] = useState<VendorPurchaseItemRow[]>([])
  const [amendmentsCount, setAmendmentsCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editVendorId, setEditVendorId] = useState('')
  const [editSupplierInvoiceNo, setEditSupplierInvoiceNo] = useState('')
  const [editPurchaseDate, setEditPurchaseDate] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  async function loadPurchase(purchaseId: string) {
    setLoading(true)
    setError(null)

    const [
      { data: purchaseData, error: purchaseError },
      { data: itemsData, error: itemsError },
      { count: amendmentsCountData },
    ] = await Promise.all([
      supabase
        .from('vendor_purchases')
        .select('*, vendors(name, gstin, contact_phone, contact_email)')
        .eq('id', purchaseId)
        .single(),
      supabase
        .from('vendor_purchase_items')
        .select(
          'id, item_type, item_name, brand, category, hsn_code, description, quantity, unit_price, gst_rate, taxable_value, gst_amount, total, serials, product_ids, spare_part_id',
        )
        .eq('purchase_id', purchaseId)
        .order('created_at', { ascending: true }),
      supabase
        .from('vendor_purchase_amendments')
        .select('id', { count: 'exact', head: true })
        .eq('purchase_id', purchaseId),
    ])

    if (purchaseError || !purchaseData) {
      setError(purchaseError?.message ?? 'Purchase not found')
      setLoading(false)
      return
    }
    if (itemsError) {
      setError(itemsError.message)
      setLoading(false)
      return
    }

    setPurchase(purchaseData as unknown as VendorPurchaseData)
    setItems(itemsData ?? [])
    setAmendmentsCount(amendmentsCountData ?? 0)
    setLoading(false)
  }

  useEffect(() => {
    if (id) void loadPurchase(id)
  }, [id])

  function openEditModal() {
    if (!purchase) return
    setEditError(null)
    setEditVendorId(purchase.vendor_id)
    setEditSupplierInvoiceNo(purchase.supplier_invoice_no ?? '')
    setEditPurchaseDate(purchase.purchase_date)
    setEditNotes(purchase.notes ?? '')
    if (vendors.length === 0) {
      supabase
        .from('vendors')
        .select('id, name')
        .order('name', { ascending: true })
        .then(({ data }) => setVendors(data ?? []))
    }
    setEditModalOpen(true)
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!purchase) return

    setEditSaving(true)
    setEditError(null)

    const { error: updateError } = await supabase
      .from('vendor_purchases')
      .update({
        vendor_id: editVendorId,
        supplier_invoice_no: editSupplierInvoiceNo.trim() || null,
        purchase_date: editPurchaseDate,
        notes: editNotes.trim() || null,
      })
      .eq('id', purchase.id)

    setEditSaving(false)

    if (updateError) {
      setEditError(updateError.message)
      return
    }

    setEditModalOpen(false)
    void loadPurchase(purchase.id)
  }

  if (loading) {
    return <p className="px-6 py-10 text-center text-sm text-slate-400">Loading purchase…</p>
  }

  if (error && !purchase) {
    return <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
  }

  if (!purchase) return null

  return (
    <div>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/vendor-purchases" className="text-sm text-slate-400 hover:text-slate-600">
            ← All Vendor Purchases
          </Link>
          <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-slate-900">
            {purchase.purchase_number}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <button
              onClick={openEditModal}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100"
            >
              Edit Details
            </button>
          )}
          {isAdmin && (
            <Link
              to={`/vendor-purchases/${purchase.id}/amend`}
              aria-disabled={items.length === 0}
              onClick={(e) => {
                if (items.length === 0) e.preventDefault()
              }}
              className={`rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors ${
                items.length === 0
                  ? 'cursor-not-allowed opacity-40'
                  : 'hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100'
              }`}
            >
              Amend Purchase
            </Link>
          )}
          <button
            onClick={() => window.print()}
            className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2 text-sm font-medium transition-opacity"
          >
            Print / Download
          </button>
        </div>
      </div>

      {error && (
        <p className="no-print mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}

      <div className="rounded-2xl bg-white p-8 card-shadow print:shadow-none">
        <PrintHeader label="Purchase Order" />

        <div className="mb-8 grid grid-cols-2 gap-6">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              Vendor
            </p>
            <p className="text-sm font-medium text-slate-900">{purchase.vendors?.name ?? '—'}</p>
            {purchase.vendors?.contact_phone && (
              <p className="text-sm text-slate-500">{purchase.vendors.contact_phone}</p>
            )}
            {purchase.vendors?.gstin && (
              <p className="text-sm text-slate-500">GSTIN: {purchase.vendors.gstin}</p>
            )}
          </div>
          <div className="text-right text-sm text-slate-500">
            <p>
              Purchase No:{' '}
              <span className="font-semibold text-slate-900">{purchase.purchase_number}</span>
            </p>
            <p className="mt-1">Date: {formatDate(purchase.purchase_date)}</p>
            {purchase.supplier_invoice_no && (
              <p className="mt-1">Supplier Invoice: {purchase.supplier_invoice_no}</p>
            )}
            <p className="mt-1">
              Payment:{' '}
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                  paymentStatusStyles[purchase.payment_status] ?? 'bg-slate-100 text-slate-500'
                }`}
              >
                {formatLabel(purchase.payment_status)}
              </span>
            </p>
            {purchase.notes && (
              <>
                <p className="mt-2 mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Notes
                </p>
                <p className="whitespace-pre-wrap">{purchase.notes}</p>
              </>
            )}
            <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
              {formatLabel(purchase.purchase_kind)}
            </span>
          </div>
        </div>

        <div className="mb-8 overflow-hidden rounded-lg border border-slate-300">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <th className="border-r border-slate-300 px-4 py-2.5">Item</th>
                <th className="border-r border-slate-300 px-4 py-2.5">HSN</th>
                <th className="border-r border-slate-300 px-4 py-2.5">Qty</th>
                <th className="border-r border-slate-300 px-4 py-2.5">Unit Price</th>
                <th className="border-r border-slate-300 px-4 py-2.5">GST</th>
                <th className="px-4 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const restocked =
                  (item.product_ids && item.product_ids.length > 0) || item.spare_part_id
                return (
                  <tr
                    key={item.id}
                    className={`border-b border-slate-200 last:border-b-0 ${
                      index % 2 === 1 ? 'bg-slate-50' : 'bg-white'
                    }`}
                  >
                    <td className="border-r border-slate-200 px-4 py-2.5">
                      <p className="font-medium text-slate-900">{item.item_name}</p>
                      <p className="text-xs text-slate-400">
                        <span className="no-print">
                          {[formatLabel(item.item_type), item.brand, item.category]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                        <span className="hidden print:inline">
                          {[item.brand, item.category].filter(Boolean).join(' · ')}
                        </span>
                      </p>
                      {item.description && (
                        <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
                      )}
                      {item.serials && item.serials.length > 0 && (
                        <p className="mt-0.5 text-xs text-slate-400">
                          Serials: {item.serials.join(', ')}
                        </p>
                      )}
                      {restocked && (
                        <p className="no-print mt-0.5 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          {item.item_type === 'product'
                            ? `Added to inventory (${item.product_ids?.length ?? 0} unit${
                                (item.product_ids?.length ?? 0) === 1 ? '' : 's'
                              })`
                            : 'Restocked'}
                        </p>
                      )}
                    </td>
                    <td className="border-r border-slate-200 px-4 py-2.5 text-slate-500">
                      {item.hsn_code ?? '—'}
                    </td>
                    <td className="border-r border-slate-200 px-4 py-2.5 text-slate-500">
                      {item.quantity}
                    </td>
                    <td className="border-r border-slate-200 px-4 py-2.5 text-slate-500">
                      {formatCurrencyExact(item.unit_price)}
                    </td>
                    <td className="border-r border-slate-200 px-4 py-2.5 text-slate-500">
                      {item.gst_rate}% ({formatCurrencyExact(item.gst_amount)})
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700">
                      {formatCurrencyExact(item.total)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between text-slate-500">
              <span>Taxable Value</span>
              <span>{formatCurrencyExact(purchase.total_taxable_value)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>GST</span>
              <span>{formatCurrencyExact(purchase.total_gst)}</span>
            </div>
            {purchase.round_off_amount !== 0 && (
              <div className="flex justify-between text-slate-500">
                <span>Round Off</span>
                <span>
                  {purchase.round_off_amount >= 0 ? '+' : '−'}
                  {formatCurrencyExact(Math.abs(purchase.round_off_amount))}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
              <span>Grand Total</span>
              <span>{formatCurrencyExact(purchase.grand_total)}</span>
            </div>
          </div>
        </div>

        <PrintFooter note="Internal purchase record — not a tax invoice." />
      </div>

      <div className="no-print mt-6 rounded-2xl bg-white p-5 card-shadow">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Payments</h2>
        <PaymentsSection
          purchaseId={purchase.id}
          grandTotal={purchase.grand_total}
          amountPaid={purchase.amount_paid}
          isAdmin={isAdmin}
          onPaymentRecorded={() => id && void loadPurchase(id)}
        />
      </div>

      <div className="no-print mt-6 rounded-2xl bg-white p-5 card-shadow">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Debit Notes</h2>
        <DebitNotesSection
          purchaseId={purchase.id}
          vendorId={purchase.vendor_id}
          items={items.map((item) => ({ id: item.id, item_name: item.item_name }))}
          isAdmin={isAdmin}
        />
      </div>

      {amendmentsCount > 0 && (
        <div className="no-print mt-6 rounded-2xl bg-white p-5 card-shadow">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Amendment History</h2>
          <AmendmentHistorySection purchaseId={purchase.id} />
        </div>
      )}

      <Modal open={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Purchase Details">
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <p className="text-sm text-slate-500">
            Only non-financial details can be changed here — vendor, supplier invoice number,
            purchase date, and notes. Prices, quantities, tax, and totals are never touched by this
            form.
          </p>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Vendor</label>
            <select
              value={editVendorId}
              onChange={(e) => setEditVendorId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
            >
              {vendors.length === 0 && purchase.vendors && (
                <option value={editVendorId}>{purchase.vendors.name}</option>
              )}
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">
                Supplier Invoice No.
              </label>
              <input
                type="text"
                value={editSupplierInvoiceNo}
                onChange={(e) => setEditSupplierInvoiceNo(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">
                Purchase Date
              </label>
              <input
                type="date"
                value={editPurchaseDate}
                onChange={(e) => setEditPurchaseDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">
              Notes (optional)
            </label>
            <textarea
              rows={2}
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Purchase Kind</label>
            <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm text-slate-500">
              <span>{formatLabel(purchase.purchase_kind)}</span>
              <span className="ml-auto text-xs text-slate-400">
                Locked — contact support if this is genuinely wrong
              </span>
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              Changing between Stock-in-Trade and Office Expense/Capital Asset after the fact could
              strand or duplicate inventory that was (or wasn't) created at purchase time.
            </p>
          </div>

          {editError && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{editError}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setEditModalOpen(false)}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={editSaving}
              className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
            >
              {editSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
