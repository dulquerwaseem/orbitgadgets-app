import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrencyExact, formatDate, formatLabel } from '../lib/format'
import PrintHeader from '../components/print/PrintHeader'
import PrintFooter from '../components/print/PrintFooter'
import InvoicePaymentsSection from '../components/invoice/InvoicePaymentsSection'
import Modal from '../components/Modal'
import CustomerPicker from '../components/CustomerPicker'
import type { Customer } from '../components/CustomerPicker'
import type { WarrantyUnit } from '../components/LineItemForm'

interface InvoiceDetailData {
  id: string
  invoice_number: string
  invoice_series: 'gst' | 'non_gst'
  customer_id: string | null
  customer_gst: string | null
  eway_bill: string | null
  discount: number
  taxable_value: number
  cgst_amount: number
  sgst_amount: number
  final_price: number
  round_off: boolean
  round_off_amount: number
  labor_charge: number
  labor_sac_code: string | null
  payment_status: string
  amount_paid: number
  converted_from_invoice_id: string | null
  superseded: boolean
  void: boolean
  void_reason: string | null
  created_at: string
  customers: {
    id: string
    name: string
    phone: string
    address: string | null
    gst_number: string | null
  } | null
  job_sheets: { job_number: string } | null
}

interface EditableItemDraft {
  id: string
  item_name: string
  description: string
  hsn_code: string
  serial_imei: string
  ram: string
  storage: string
  warranty_days: string
  warranty_unit: WarrantyUnit
  warranty_notes: string
}

interface InvoiceItemRow {
  id: string
  item_type: string
  item_name: string
  description: string | null
  hsn_code: string | null
  serial_imei: string | null
  ram: string | null
  storage: string | null
  quantity: number
  unit_price: number
  total_price: number
  warranty_days: number | null
  warranty_unit: WarrantyUnit
  warranty_notes: string | null
}

const warrantyUnitLabels: Record<WarrantyUnit, string> = {
  days: 'day',
  months: 'month',
  years: 'year',
}

function warrantyUntil(invoiceCreatedAt: string, amount: number, unit: WarrantyUnit): string {
  const until = new Date(invoiceCreatedAt)
  if (unit === 'months') {
    until.setMonth(until.getMonth() + amount)
  } else if (unit === 'years') {
    until.setFullYear(until.getFullYear() + amount)
  } else {
    until.setDate(until.getDate() + amount)
  }
  return formatDate(until.toISOString())
}

interface CreditNoteRow {
  id: string
  credit_note_number: string
  return_date: string
  total_refunded: number
}

const paymentStatusStyles: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-600',
  partial: 'bg-amber-50 text-amber-600',
  unpaid: 'bg-red-50 text-red-500',
}

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { membership } = useAuth()
  const isAdmin = membership?.role === 'admin'

  const [invoice, setInvoice] = useState<InvoiceDetailData | null>(null)
  const [items, setItems] = useState<InvoiceItemRow[]>([])
  const [creditNotes, setCreditNotes] = useState<CreditNoteRow[]>([])
  const [supersededBy, setSupersededBy] = useState<{ id: string; invoice_number: string } | null>(null)
  const [paymentsCount, setPaymentsCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)

  const [voidModalOpen, setVoidModalOpen] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [voidError, setVoidError] = useState<string | null>(null)

  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null)
  const [editItems, setEditItems] = useState<EditableItemDraft[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  async function loadInvoice(invoiceId: string) {
    setLoading(true)
    setError(null)

    const [
      { data: invoiceData, error: invoiceError },
      { data: itemsData, error: itemsError },
      { data: creditNoteData },
      { count: paymentsCountData },
    ] = await Promise.all([
      supabase
        .from('invoices')
        .select(
          '*, customers(id, name, phone, address, gst_number), job_sheets!invoices_job_sheet_id_fkey(job_number)',
        )
        .eq('id', invoiceId)
        .single(),
      supabase
        .from('invoice_items')
        .select(
          'id, item_type, item_name, description, hsn_code, serial_imei, ram, storage, quantity, unit_price, total_price, warranty_days, warranty_unit, warranty_notes',
        )
        .eq('invoice_id', invoiceId)
        .order('created_at', { ascending: true }),
      supabase
        .from('credit_notes')
        .select('id, credit_note_number, return_date, total_refunded')
        .eq('invoice_id', invoiceId)
        .order('created_at', { ascending: false }),
      supabase
        .from('invoice_payments')
        .select('id', { count: 'exact', head: true })
        .eq('invoice_id', invoiceId),
    ])

    if (invoiceError || !invoiceData) {
      setError(invoiceError?.message ?? 'Invoice not found')
      setLoading(false)
      return
    }
    if (itemsError) {
      setError(itemsError.message)
      setLoading(false)
      return
    }

    setInvoice(invoiceData as unknown as InvoiceDetailData)
    setItems(itemsData ?? [])
    setCreditNotes(creditNoteData ?? [])
    setPaymentsCount(paymentsCountData ?? 0)

    if ((invoiceData as unknown as InvoiceDetailData).superseded) {
      const { data: newer } = await supabase
        .from('invoices')
        .select('id, invoice_number')
        .eq('converted_from_invoice_id', invoiceId)
        .maybeSingle()
      setSupersededBy(newer ?? null)
    } else {
      setSupersededBy(null)
    }

    setLoading(false)
  }

  useEffect(() => {
    if (id) void loadInvoice(id)
  }, [id])

  async function handleConvert() {
    if (!id) return
    if (
      !window.confirm(
        'Convert this invoice to a GST invoice? The original will be marked as superseded.',
      )
    )
      return

    setConverting(true)
    setError(null)
    const { data, error } = await supabase.rpc('convert_invoice_to_gst', { p_invoice_id: id })
    setConverting(false)

    if (error) {
      setError(error.message)
      return
    }

    navigate(`/invoices/${data.id}`)
  }

  function openVoidModal() {
    setVoidReason('')
    setVoidError(null)
    setVoidModalOpen(true)
  }

  async function handleVoid(e: FormEvent) {
    e.preventDefault()
    if (!id) return
    if (!voidReason.trim()) {
      setVoidError('A reason is required.')
      return
    }
    if (
      !window.confirm(
        'Void this invoice? This reverses its inventory effects and cannot be undone.',
      )
    )
      return

    setVoiding(true)
    setVoidError(null)

    const { error } = await supabase.rpc('void_invoice', {
      p_invoice_id: id,
      p_reason: voidReason.trim(),
    })

    setVoiding(false)

    if (error) {
      setVoidError(error.message)
      return
    }

    setVoidModalOpen(false)
    void loadInvoice(id)
  }

  function openEditModal() {
    if (!invoice) return
    setEditError(null)
    setEditCustomer(
      invoice.customers
        ? {
            id: invoice.customers.id,
            name: invoice.customers.name,
            phone: invoice.customers.phone,
            address: invoice.customers.address,
            gst_number: invoice.customers.gst_number,
          }
        : null,
    )
    setEditItems(
      items.map((item) => ({
        id: item.id,
        item_name: item.item_name,
        description: item.description ?? '',
        hsn_code: item.hsn_code ?? '',
        serial_imei: item.serial_imei ?? '',
        ram: item.ram ?? '',
        storage: item.storage ?? '',
        warranty_days: item.warranty_days != null ? String(item.warranty_days) : '',
        warranty_unit: item.warranty_unit,
        warranty_notes: item.warranty_notes ?? '',
      })),
    )
    setEditModalOpen(true)
  }

  function updateEditItem(itemId: string, patch: Partial<EditableItemDraft>) {
    setEditItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...patch } : item)))
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault()
    if (!invoice) return

    if (editItems.some((item) => item.item_name.trim() === '')) {
      setEditError('Item name cannot be empty.')
      return
    }

    setEditSaving(true)
    setEditError(null)

    const invoiceUpdate: { customer_id: string | null; customer_gst?: string | null } = {
      customer_id: editCustomer?.id ?? null,
    }
    if (invoice.invoice_series === 'gst') {
      invoiceUpdate.customer_gst = editCustomer?.gst_number ?? null
    }

    const { error: invoiceUpdateError } = await supabase
      .from('invoices')
      .update(invoiceUpdate)
      .eq('id', invoice.id)

    if (invoiceUpdateError) {
      setEditSaving(false)
      setEditError(invoiceUpdateError.message)
      return
    }

    for (const item of editItems) {
      const { error: itemUpdateError } = await supabase
        .from('invoice_items')
        .update({
          item_name: item.item_name.trim(),
          description: item.description.trim() || null,
          hsn_code: item.hsn_code.trim() || null,
          serial_imei: item.serial_imei.trim() || null,
          ram: item.ram.trim() || null,
          storage: item.storage.trim() || null,
          warranty_days: item.warranty_days.trim() ? Number(item.warranty_days) : null,
          warranty_unit: item.warranty_unit,
          warranty_notes: item.warranty_notes.trim() || null,
        })
        .eq('id', item.id)

      if (itemUpdateError) {
        setEditSaving(false)
        setEditError(itemUpdateError.message)
        return
      }
    }

    setEditSaving(false)
    setEditModalOpen(false)
    void loadInvoice(invoice.id)
  }

  if (loading) {
    return <p className="px-6 py-10 text-center text-sm text-slate-400">Loading invoice…</p>
  }

  if (error && !invoice) {
    return <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
  }

  if (!invoice) return null

  const balanceDue = invoice.final_price - invoice.amount_paid

  return (
    <div>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/invoices" className="text-sm text-slate-400 hover:text-slate-600">
            ← All Invoices
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">
              {invoice.invoice_number}
            </h1>
            {invoice.void && (
              <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                Void
              </span>
            )}
            {creditNotes.length > 0 && (
              <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                Returned
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && !invoice.superseded && !invoice.void && (
            <button
              onClick={openEditModal}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100"
            >
              Edit Invoice
            </button>
          )}
          {!invoice.superseded && !invoice.void && creditNotes.length === 0 && paymentsCount === 0 && (
            <button
              onClick={openVoidModal}
              className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:border-red-300 hover:bg-red-50 active:bg-red-100"
            >
              Void Invoice
            </button>
          )}
          {!invoice.superseded && !invoice.void && (
            <Link
              to={`/invoices/${invoice.id}/credit-notes/new`}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100"
            >
              Create Credit Note
            </Link>
          )}
          {invoice.invoice_series === 'non_gst' && !invoice.superseded && !invoice.void && (
            <button
              onClick={() => void handleConvert()}
              disabled={converting}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50"
            >
              {converting ? 'Converting…' : 'Convert to GST Invoice'}
            </button>
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

      {invoice.void && (
        <div className="no-print mb-4 rounded-xl bg-slate-100 px-4 py-2.5 text-sm text-slate-600">
          This invoice was voided.{invoice.void_reason ? ` Reason: ${invoice.void_reason}` : ''}
        </div>
      )}

      {invoice.superseded && (
        <div className="no-print mb-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          This invoice has been superseded by a GST invoice.
          {supersededBy && (
            <>
              {' '}
              <Link to={`/invoices/${supersededBy.id}`} className="font-medium underline">
                View {supersededBy.invoice_number}
              </Link>
            </>
          )}
        </div>
      )}

      <div className="rounded-2xl bg-white p-8 card-shadow print:shadow-none">
        <PrintHeader label="Invoice" showGstin={invoice.invoice_series === 'gst'} />

        <div className="mb-8 grid grid-cols-2 gap-6">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              Billed To
            </p>
            <p className="text-sm font-medium text-slate-900">{invoice.customers?.name ?? '—'}</p>
            <p className="text-sm text-slate-500">{invoice.customers?.phone}</p>
            {invoice.customers?.address && (
              <p className="text-sm text-slate-500">{invoice.customers.address}</p>
            )}
            {invoice.customer_gst && (
              <p className="text-sm text-slate-500">GSTIN: {invoice.customer_gst}</p>
            )}
          </div>
          <div className="text-right text-sm text-slate-500">
            <p>
              Invoice No:{' '}
              <span className="font-semibold text-slate-900">{invoice.invoice_number}</span>
            </p>
            <p className="mt-1">Date: {formatDate(invoice.created_at)}</p>
            {invoice.job_sheets && <p className="mt-1">Job Sheet: {invoice.job_sheets.job_number}</p>}
            {invoice.eway_bill && <p className="mt-1">E-way Bill: {invoice.eway_bill}</p>}
            <p className="mt-1">
              Payment:{' '}
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                  paymentStatusStyles[invoice.payment_status] ?? 'bg-slate-100 text-slate-500'
                }`}
              >
                {formatLabel(invoice.payment_status)}
              </span>
            </p>
          </div>
        </div>

        <div className="mb-8 overflow-hidden rounded-lg border border-slate-300">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <th className="border-r border-slate-300 px-4 py-2.5">Item</th>
                <th className="border-r border-slate-300 px-4 py-2.5">HSN/SAC</th>
                <th className="border-r border-slate-300 px-4 py-2.5">Qty</th>
                <th className="border-r border-slate-300 px-4 py-2.5">Unit Price</th>
                <th className="px-4 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
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
                        {[
                          formatLabel(item.item_type),
                          item.serial_imei && `IMEI ${item.serial_imei}`,
                          item.ram,
                          item.storage,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span className="hidden print:inline">
                        {[item.serial_imei && `IMEI ${item.serial_imei}`, item.ram, item.storage]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </p>
                    {item.description && (
                      <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
                    )}
                    {item.warranty_days != null && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        Warranty: {item.warranty_days} {warrantyUnitLabels[item.warranty_unit]}
                        {item.warranty_days === 1 ? '' : 's'} (until{' '}
                        {warrantyUntil(invoice.created_at, item.warranty_days, item.warranty_unit)})
                        {item.warranty_notes ? ` — ${item.warranty_notes}` : ''}
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
                  <td className="px-4 py-2.5 text-right text-slate-700">
                    {formatCurrencyExact(item.total_price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between text-slate-500">
              <span>Items Subtotal</span>
              <span>
                {formatCurrencyExact(items.reduce((sum, item) => sum + item.total_price, 0))}
              </span>
            </div>
            {invoice.labor_charge > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>
                  Labor Charge{invoice.labor_sac_code ? ` (${invoice.labor_sac_code})` : ''}
                </span>
                <span>{formatCurrencyExact(invoice.labor_charge)}</span>
              </div>
            )}
            {invoice.discount > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>Discount</span>
                <span>−{formatCurrencyExact(invoice.discount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-2 font-medium text-slate-700">
              <span>Taxable Value</span>
              <span>{formatCurrencyExact(invoice.taxable_value)}</span>
            </div>
            {invoice.invoice_series === 'gst' && (
              <>
                <div className="flex justify-between text-slate-500">
                  <span>CGST (9%)</span>
                  <span>{formatCurrencyExact(invoice.cgst_amount)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>SGST (9%)</span>
                  <span>{formatCurrencyExact(invoice.sgst_amount)}</span>
                </div>
              </>
            )}
            {invoice.round_off_amount !== 0 && (
              <div className="flex justify-between text-slate-500">
                <span>Round Off</span>
                <span>
                  {invoice.round_off_amount >= 0 ? '+' : '−'}
                  {formatCurrencyExact(Math.abs(invoice.round_off_amount))}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
              <span>Total</span>
              <span>{formatCurrencyExact(invoice.final_price)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Amount Paid</span>
              <span>{formatCurrencyExact(invoice.amount_paid)}</span>
            </div>
            <div className="flex justify-between font-medium text-slate-900">
              <span>Balance Due</span>
              <span>{formatCurrencyExact(balanceDue)}</span>
            </div>
          </div>
        </div>

        <PrintFooter note="Thank you for your business." />
      </div>

      {!invoice.superseded && !invoice.void && (
        <div className="no-print mt-6 rounded-2xl bg-white p-5 card-shadow">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Payments</h2>
          <InvoicePaymentsSection
            invoiceId={invoice.id}
            finalPrice={invoice.final_price}
            amountPaid={invoice.amount_paid}
            onPaymentRecorded={() => id && void loadInvoice(id)}
          />
        </div>
      )}

      {creditNotes.length > 0 && (
        <div className="no-print mt-6 rounded-2xl bg-white p-5 card-shadow">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Credit Notes</h2>
          <div className="space-y-2">
            {creditNotes.map((cn) => (
              <Link
                key={cn.id}
                to={`/credit-notes/${cn.id}`}
                className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-2.5 text-sm transition-colors hover:bg-slate-50 active:bg-slate-100"
              >
                <div>
                  <span className="font-medium text-slate-900">{cn.credit_note_number}</span>
                  <span className="ml-2 text-slate-400">{formatDate(cn.return_date)}</span>
                </div>
                <span className="font-medium text-slate-700">
                  −{formatCurrencyExact(cn.total_refunded)}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <Modal open={voidModalOpen} onClose={() => setVoidModalOpen(false)} title="Void Invoice">
        <form onSubmit={handleVoid} className="space-y-4">
          <p className="text-sm text-slate-500">
            This is for genuine data-entry mistakes — wrong customer, mistyped price — not a
            return or refund. Voiding reverses this invoice's inventory effects and cannot be
            undone. Use a credit note instead if the sale itself was correct.
          </p>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Reason</label>
            <textarea
              required
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="e.g. Wrong customer selected, invoice recreated as INV-..."
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </div>

          {voidError && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{voidError}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setVoidModalOpen(false)}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={voiding}
              className="rounded-xl bg-red-600 text-white hover:opacity-90 active:opacity-100 px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
            >
              {voiding ? 'Voiding…' : 'Void Invoice'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={editModalOpen} onClose={() => setEditModalOpen(false)} title="Edit Invoice">
        <form onSubmit={handleSaveEdit} className="space-y-5">
          <p className="text-sm text-slate-500">
            Only non-financial details can be changed here — customer, and per-item name,
            description, HSN/SAC, serial/spec, and warranty. Price, quantity, tax, and totals
            are never touched by this form.
          </p>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Customer</label>
            <CustomerPicker value={editCustomer} onChange={setEditCustomer} />
          </div>

          <div className="space-y-4">
            {editItems.map((item, index) => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Item {index + 1}
                </p>
                <div className="space-y-2">
                  <input
                    type="text"
                    required
                    placeholder="Item name"
                    value={item.item_name}
                    onChange={(e) => updateEditItem(item.id, { item_name: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  />
                  <textarea
                    placeholder="Description (optional)"
                    rows={2}
                    value={item.description}
                    onChange={(e) => updateEditItem(item.id, { description: e.target.value })}
                    className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="HSN/SAC code"
                      value={item.hsn_code}
                      onChange={(e) => updateEditItem(item.id, { hsn_code: e.target.value })}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                    />
                    <input
                      type="text"
                      placeholder="Serial/IMEI"
                      value={item.serial_imei}
                      onChange={(e) => updateEditItem(item.id, { serial_imei: e.target.value })}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="RAM"
                      value={item.ram}
                      onChange={(e) => updateEditItem(item.id, { ram: e.target.value })}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                    />
                    <input
                      type="text"
                      placeholder="Storage"
                      value={item.storage}
                      onChange={(e) => updateEditItem(item.id, { storage: e.target.value })}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                    />
                  </div>
                  <div className="grid grid-cols-[auto_auto_1fr] gap-2">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="Warranty"
                      value={item.warranty_days}
                      onChange={(e) => updateEditItem(item.id, { warranty_days: e.target.value })}
                      className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                    />
                    <select
                      value={item.warranty_unit}
                      onChange={(e) =>
                        updateEditItem(item.id, { warranty_unit: e.target.value as WarrantyUnit })
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                    >
                      {(['days', 'months', 'years'] as WarrantyUnit[]).map((unit) => (
                        <option key={unit} value={unit}>
                          {formatLabel(unit)}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      placeholder="Warranty notes"
                      value={item.warranty_notes}
                      onChange={(e) => updateEditItem(item.id, { warranty_notes: e.target.value })}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                    />
                  </div>
                </div>
              </div>
            ))}
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
