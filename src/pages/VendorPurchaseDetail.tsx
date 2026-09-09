import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrencyExact, formatDate, formatLabel } from '../lib/format'
import PaymentsSection from '../components/vendorpurchase/PaymentsSection'
import DebitNotesSection from '../components/vendorpurchase/DebitNotesSection'
import PrintHeader from '../components/print/PrintHeader'
import PrintFooter from '../components/print/PrintFooter'

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

export default function VendorPurchaseDetail() {
  const { id } = useParams<{ id: string }>()
  const { membership } = useAuth()
  const isAdmin = membership?.role === 'admin'

  const [purchase, setPurchase] = useState<VendorPurchaseData | null>(null)
  const [items, setItems] = useState<VendorPurchaseItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadPurchase(purchaseId: string) {
    setLoading(true)
    setError(null)

    const [{ data: purchaseData, error: purchaseError }, { data: itemsData, error: itemsError }] =
      await Promise.all([
        supabase
          .from('vendor_purchases')
          .select('*, vendors(name, gstin, contact_phone, contact_email)')
          .eq('id', purchaseId)
          .single(),
        supabase
          .from('vendor_purchase_items')
          .select(
            'id, item_type, item_name, brand, category, hsn_code, quantity, unit_price, gst_rate, taxable_value, gst_amount, total, serials, product_ids, spare_part_id',
          )
          .eq('purchase_id', purchaseId)
          .order('created_at', { ascending: true }),
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
    setLoading(false)
  }

  useEffect(() => {
    if (id) void loadPurchase(id)
  }, [id])

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
        <button
          onClick={() => window.print()}
          className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2 text-sm font-medium transition-opacity"
        >
          Print / Download
        </button>
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
    </div>
  )
}
