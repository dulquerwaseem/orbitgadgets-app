import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrencyExact, formatLabel } from '../lib/format'
import CustomerPicker from '../components/CustomerPicker'
import type { Customer } from '../components/CustomerPicker'
import JobSheetPicker from '../components/invoice/JobSheetPicker'
import type { JobSheetOption } from '../components/invoice/JobSheetPicker'
import LineItemForm from '../components/LineItemForm'
import type { DraftItem } from '../components/LineItemForm'

type InvoiceSeries = 'gst' | 'non_gst'
type PaymentStatus = 'unpaid' | 'partial' | 'paid'

const paymentStatusOptions: PaymentStatus[] = ['unpaid', 'partial', 'paid']

// Passed via navigate(..., { state }) from a job sheet's "Mark Delivered & Bill" button.
interface InvoiceNewLocationState {
  jobSheetId?: string
  jobSheetNumber?: string
  deviceName?: string | null
  customer?: Customer
}

export default function InvoiceNew() {
  const { membership } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const prefill = (location.state ?? null) as InvoiceNewLocationState | null

  const [invoiceSeries, setInvoiceSeries] = useState<InvoiceSeries>('non_gst')
  const [customer, setCustomer] = useState<Customer | null>(() => prefill?.customer ?? null)
  const [jobSheet, setJobSheet] = useState<JobSheetOption | null>(() =>
    prefill?.jobSheetId
      ? {
          id: prefill.jobSheetId,
          job_number: prefill.jobSheetNumber ?? '',
          device_name: prefill.deviceName ?? null,
          customer_id: prefill.customer?.id ?? null,
        }
      : null,
  )
  const [customerGst, setCustomerGst] = useState(() => prefill?.customer?.gst_number ?? '')
  const [ewayBill, setEwayBill] = useState('')

  const [items, setItems] = useState<DraftItem[]>([])
  const [laborCharge, setLaborCharge] = useState('')
  const [laborSacCode, setLaborSacCode] = useState('')
  const [discount, setDiscount] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('paid')
  const [amountPaid, setAmountPaid] = useState('')
  const [amountPaidTouched, setAmountPaidTouched] = useState(false)
  const [roundOff, setRoundOff] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleCustomerChange(next: Customer | null) {
    setCustomer(next)
    setCustomerGst(next?.gst_number ?? '')
  }

  const itemsSubtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0),
    [items],
  )
  const laborChargeNum = Number(laborCharge) || 0
  const discountNum = Number(discount) || 0
  const taxableValue = itemsSubtotal + laborChargeNum - discountNum
  const cgstAmount = invoiceSeries === 'gst' ? Math.round(taxableValue * 0.09 * 100) / 100 : 0
  const sgstAmount = invoiceSeries === 'gst' ? Math.round(taxableValue * 0.09 * 100) / 100 : 0
  const preRoundTotal = taxableValue + cgstAmount + sgstAmount
  const roundOffAmount = roundOff ? Math.round(preRoundTotal) - preRoundTotal : 0
  const grandTotal = roundOff ? Math.round(preRoundTotal) : preRoundTotal
  const amountPaidDisplay = amountPaidTouched ? amountPaid : grandTotal.toFixed(2)

  function removeItem(key: string) {
    setItems((prev) => prev.filter((item) => item.key !== key))
  }

  async function handleSubmit() {
    if (!membership) return
    setError(null)

    if (!customer) {
      setError('Select or add a customer before saving.')
      return
    }
    if (items.length === 0) {
      setError('Add at least one line item before saving.')
      return
    }

    setSaving(true)

    const { data, error } = await supabase.rpc('create_invoice', {
      p_tenant_id: membership.tenantId,
      p_invoice_series: invoiceSeries,
      p_customer_id: customer.id,
      p_job_sheet_id: jobSheet?.id ?? null,
      p_customer_gst: customerGst.trim() || null,
      p_eway_bill: ewayBill.trim() || null,
      p_discount: discountNum,
      p_labor_charge: laborChargeNum,
      p_labor_sac_code: laborSacCode.trim() || null,
      p_payment_status: paymentStatus,
      p_amount_paid: Number(amountPaidDisplay) || 0,
      p_round_off: roundOff,
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

    if (error) {
      setError(error.message)
      return
    }

    navigate(`/invoices/${data.id}`)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">New Invoice</h1>
        <p className="mt-1 text-sm text-slate-400">Create an invoice with or without a job sheet.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Invoice Series</h2>
            <div className="flex gap-2">
              {(['non_gst', 'gst'] as InvoiceSeries[]).map((series) => (
                <button
                  key={series}
                  type="button"
                  onClick={() => setInvoiceSeries(series)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    invoiceSeries === series
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {series === 'gst' ? 'GST' : 'Non-GST'}
                </button>
              ))}
            </div>
            {invoiceSeries === 'gst' && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-600">
                    Customer GSTIN
                  </label>
                  <input
                    type="text"
                    value={customerGst}
                    onChange={(e) => setCustomerGst(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-600">
                    E-way Bill (optional)
                  </label>
                  <input
                    type="text"
                    value={ewayBill}
                    onChange={(e) => setEwayBill(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                  />
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Customer</h2>
            <CustomerPicker value={customer} onChange={handleCustomerChange} />
          </section>

          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Job Sheet (optional)</h2>
            <JobSheetPicker value={jobSheet} onChange={setJobSheet} />
          </section>

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
            </div>
          </section>
        </div>

        <div className="space-y-6 lg:sticky lg:top-8 lg:self-start">
          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Payment</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">
                  Payment Status
                </label>
                <select
                  value={paymentStatus}
                  onChange={(e) => {
                    const next = e.target.value as PaymentStatus
                    setPaymentStatus(next)
                    if (next === 'unpaid') {
                      setAmountPaid('0')
                      setAmountPaidTouched(true)
                    }
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                >
                  {paymentStatusOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {formatLabel(opt)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Amount Paid</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amountPaidDisplay}
                  onChange={(e) => {
                    setAmountPaid(e.target.value)
                    setAmountPaidTouched(true)
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-500">
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
              {invoiceSeries === 'gst' && (
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
                <span>Total</span>
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
              {saving ? 'Saving…' : 'Save Invoice'}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
