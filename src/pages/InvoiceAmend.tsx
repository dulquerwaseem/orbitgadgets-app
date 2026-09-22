import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrencyExact, formatLabel, round2 } from '../lib/format'
import LineItemForm from '../components/LineItemForm'
import type { DraftItem, WarrantyUnit } from '../components/LineItemForm'

interface AmendInvoiceData {
  id: string
  invoice_number: string
  invoice_series: 'gst' | 'non_gst'
  discount: number
  labor_charge: number
  labor_sac_code: string | null
  round_off: boolean
  tax_inclusive_entry: boolean
  final_price: number
  void: boolean
  superseded: boolean
  customers: { name: string } | null
}

interface ExistingItemRow {
  id: string
  item_type: DraftItem['item_type']
  product_id: string | null
  spare_part_id: string | null
  item_name: string
  description: string | null
  hsn_code: string | null
  serial_imei: string | null
  ram: string | null
  storage: string | null
  quantity: number
  unit_price: number
  cost_price: number | null
  warranty_days: number | null
  warranty_unit: WarrantyUnit
  warranty_notes: string | null
}

export default function InvoiceAmend() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [invoice, setInvoice] = useState<AmendInvoiceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [items, setItems] = useState<DraftItem[]>([])
  const [laborCharge, setLaborCharge] = useState('')
  const [laborSacCode, setLaborSacCode] = useState('')
  const [discount, setDiscount] = useState('')
  const [roundOff, setRoundOff] = useState(false)
  const [taxInclusive, setTaxInclusive] = useState(false)
  const [reason, setReason] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let active = true

    async function load() {
      setLoading(true)
      setLoadError(null)

      const [{ data: invoiceData, error: invoiceError }, { data: itemsData, error: itemsError }] =
        await Promise.all([
          supabase
            .from('invoices')
            .select(
              'id, invoice_number, invoice_series, discount, labor_charge, labor_sac_code, round_off, tax_inclusive_entry, final_price, void, superseded, customers(name)',
            )
            .eq('id', id)
            .single(),
          supabase
            .from('invoice_items')
            .select(
              'id, item_type, product_id, spare_part_id, item_name, description, hsn_code, serial_imei, ram, storage, quantity, unit_price, cost_price, warranty_days, warranty_unit, warranty_notes',
            )
            .eq('invoice_id', id)
            .order('created_at', { ascending: true }),
        ])

      if (!active) return

      if (invoiceError || !invoiceData) {
        setLoadError(invoiceError?.message ?? 'Invoice not found')
        setLoading(false)
        return
      }
      if (itemsError) {
        setLoadError(itemsError.message)
        setLoading(false)
        return
      }

      const invoiceRow = invoiceData as unknown as AmendInvoiceData
      setInvoice(invoiceRow)
      setLaborCharge(invoiceRow.labor_charge ? String(invoiceRow.labor_charge) : '')
      setLaborSacCode(invoiceRow.labor_sac_code ?? '')
      setDiscount(invoiceRow.discount ? String(invoiceRow.discount) : '')
      setRoundOff(invoiceRow.round_off)
      setTaxInclusive(invoiceRow.tax_inclusive_entry)
      setItems(
        ((itemsData ?? []) as ExistingItemRow[]).map((item) => ({
          key: item.id,
          item_type: item.item_type,
          product_id: item.product_id,
          spare_part_id: item.spare_part_id,
          item_name: item.item_name,
          description: item.description,
          hsn_code: item.hsn_code,
          serial_imei: item.serial_imei,
          ram: item.ram,
          storage: item.storage,
          quantity: item.quantity,
          unit_price: item.unit_price,
          cost_price: item.cost_price,
          warranty_days: item.warranty_days,
          warranty_unit: item.warranty_unit,
          warranty_notes: item.warranty_notes,
        })),
      )
      setLoading(false)
    }

    void load()
    return () => {
      active = false
    }
  }, [id])

  const itemsSubtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0),
    [items],
  )
  const laborChargeNum = Number(laborCharge) || 0
  const discountNum = Number(discount) || 0
  const combinedAmount = itemsSubtotal + laborChargeNum - discountNum
  const isGst = invoice?.invoice_series === 'gst'
  const isTaxInclusive = isGst && taxInclusive

  const taxableValue = isTaxInclusive ? round2(combinedAmount / 1.18) : combinedAmount
  const cgstAmount = isTaxInclusive
    ? round2((combinedAmount - taxableValue) / 2)
    : isGst
      ? round2(taxableValue * 0.09)
      : 0
  const sgstAmount = cgstAmount
  const preRoundTotal = isTaxInclusive ? combinedAmount : taxableValue + cgstAmount + sgstAmount
  const roundOffAmount = roundOff ? Math.round(preRoundTotal) - preRoundTotal : 0
  const grandTotal = roundOff ? Math.round(preRoundTotal) : preRoundTotal

  function removeItem(key: string) {
    setItems((prev) => prev.filter((item) => item.key !== key))
  }

  async function handleSubmit() {
    if (!id || !invoice) return
    setError(null)

    if (items.length === 0) {
      setError('An invoice must have at least one line item.')
      return
    }
    if (!reason.trim()) {
      setError('A reason is required to amend an invoice.')
      return
    }

    setSaving(true)

    const { error: amendError } = await supabase.rpc('amend_invoice', {
      p_invoice_id: id,
      p_reason: reason.trim(),
      p_discount: discountNum,
      p_labor_charge: laborChargeNum,
      p_labor_sac_code: laborSacCode.trim() || null,
      p_round_off: roundOff,
      p_tax_inclusive: isTaxInclusive,
      p_items: items.map((item) => ({
        item_type: item.item_type,
        product_id: item.product_id,
        spare_part_id: item.spare_part_id,
        item_name: item.item_name,
        description: item.description,
        hsn_code: item.hsn_code,
        serial_imei: item.serial_imei,
        ram: item.ram,
        storage: item.storage,
        quantity: item.quantity,
        unit_price: item.unit_price,
        cost_price: item.cost_price,
        warranty_days: item.warranty_days,
        warranty_unit: item.warranty_unit,
        warranty_notes: item.warranty_notes,
      })),
    })

    setSaving(false)

    if (amendError) {
      setError(amendError.message)
      return
    }

    navigate(`/invoices/${id}`)
  }

  if (loading) {
    return <p className="px-6 py-10 text-center text-sm text-slate-400">Loading invoice…</p>
  }

  if (loadError && !invoice) {
    return <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{loadError}</p>
  }

  if (!invoice) return null

  if (invoice.void || invoice.superseded) {
    return (
      <div>
        <Link to={`/invoices/${invoice.id}`} className="text-sm text-slate-400 hover:text-slate-600">
          ← {invoice.invoice_number}
        </Link>
        <p className="mt-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">
          {invoice.void ? 'A voided invoice' : 'A superseded invoice'} cannot be amended.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <Link to={`/invoices/${invoice.id}`} className="text-sm text-slate-400 hover:text-slate-600">
          ← {invoice.invoice_number}
        </Link>
        <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-slate-900">
          Amend Invoice
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Correct price, quantity, or tax mistakes on {invoice.invoice_number}
          {invoice.customers?.name ? ` · ${invoice.customers.name}` : ''}. This creates a permanent,
          visible amendment record — it is not for returns (use a credit note) or same-day
          data-entry mistakes with no financial activity (use void).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Line Items</h2>

            {items.length > 0 && (
              <div className="mb-4 overflow-hidden rounded-xl border border-slate-100">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-2">Item</th>
                      <th className="px-4 py-2">Type</th>
                      <th className="px-4 py-2">Qty</th>
                      <th className="px-4 py-2">Unit Price</th>
                      <th className="px-4 py-2">Total</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.key} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-2.5 font-medium text-slate-900">{item.item_name}</td>
                        <td className="px-4 py-2.5 text-slate-500">{formatLabel(item.item_type)}</td>
                        <td className="px-4 py-2.5 text-slate-500">{item.quantity}</td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {formatCurrencyExact(item.unit_price)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          {formatCurrencyExact(item.quantity * item.unit_price)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => removeItem(item.key)}
                            className="text-xs font-medium text-red-500 hover:text-red-700"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="mb-3 text-xs text-slate-400">
              To correct a price or quantity, remove the incorrect line below and add it back with
              the right values.
            </p>

            <LineItemForm onAdd={(item) => setItems((prev) => [...prev, item])} showWarranty />
          </section>

          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Additional Charges</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-600">
                    Labor Charge
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={laborCharge}
                    onChange={(e) => setLaborCharge(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-600">SAC Code</label>
                  <input
                    type="text"
                    value={laborSacCode}
                    onChange={(e) => setLaborSacCode(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Discount</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={roundOff}
                  onChange={(e) => setRoundOff(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                Round off total
              </label>
              {isGst && (
                <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={taxInclusive}
                    onChange={(e) => setTaxInclusive(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                  />
                  Prices include GST
                </label>
              )}
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Reason for Amendment</h2>
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Mistyped unit price on the screen repair line — should be ₹999, not ₹1,199"
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </section>
        </div>

        <div className="space-y-6 lg:sticky lg:top-8 lg:self-start">
          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Current Total</span>
                <span>{formatCurrencyExact(invoice.final_price)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2 text-slate-500">
                <span>Items Subtotal</span>
                <span>{formatCurrencyExact(itemsSubtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Labor Charge</span>
                <span>{formatCurrencyExact(laborChargeNum)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Discount</span>
                <span>−{formatCurrencyExact(discountNum)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2 font-medium text-slate-700">
                <span>Taxable Value</span>
                <span>{formatCurrencyExact(taxableValue)}</span>
              </div>
              {isGst && (
                <>
                  <div className="flex justify-between text-slate-500">
                    <span>CGST (9%)</span>
                    <span>{formatCurrencyExact(cgstAmount)}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>SGST (9%)</span>
                    <span>{formatCurrencyExact(sgstAmount)}</span>
                  </div>
                </>
              )}
              {roundOff && (
                <div className="flex justify-between text-slate-500">
                  <span>Round Off</span>
                  <span>
                    {roundOffAmount >= 0 ? '+' : '−'}
                    {formatCurrencyExact(Math.abs(roundOffAmount))}
                  </span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
                <span>New Total</span>
                <span>{formatCurrencyExact(grandTotal)}</span>
              </div>
            </div>

            {error && (
              <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            )}

            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving}
              className="mt-4 w-full rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Amendment'}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
