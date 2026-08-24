import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrencyExact, formatDate, formatLabel } from '../lib/format'
import PrintHeader from '../components/print/PrintHeader'
import PrintFooter from '../components/print/PrintFooter'
import InvoicePaymentsSection from '../components/invoice/InvoicePaymentsSection'

interface InvoiceDetailData {
  id: string
  invoice_number: string
  invoice_series: 'gst' | 'non_gst'
  customer_gst: string | null
  eway_bill: string | null
  discount: number
  taxable_value: number
  cgst_amount: number
  sgst_amount: number
  final_price: number
  labor_charge: number
  labor_sac_code: string | null
  payment_status: string
  amount_paid: number
  converted_from_invoice_id: string | null
  superseded: boolean
  created_at: string
  customers: { name: string; phone: string; address: string | null; gst_number: string | null } | null
  job_sheets: { job_number: string } | null
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

  const [invoice, setInvoice] = useState<InvoiceDetailData | null>(null)
  const [items, setItems] = useState<InvoiceItemRow[]>([])
  const [creditNotes, setCreditNotes] = useState<CreditNoteRow[]>([])
  const [supersededBy, setSupersededBy] = useState<{ id: string; invoice_number: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)

  async function loadInvoice(invoiceId: string) {
    setLoading(true)
    setError(null)

    const [
      { data: invoiceData, error: invoiceError },
      { data: itemsData, error: itemsError },
      { data: creditNoteData },
    ] = await Promise.all([
      supabase
        .from('invoices')
        .select(
          '*, customers(name, phone, address, gst_number), job_sheets!invoices_job_sheet_id_fkey(job_number)',
        )
        .eq('id', invoiceId)
        .single(),
      supabase
        .from('invoice_items')
        .select(
          'id, item_type, item_name, description, hsn_code, serial_imei, ram, storage, quantity, unit_price, total_price',
        )
        .eq('invoice_id', invoiceId)
        .order('created_at', { ascending: true }),
      supabase
        .from('credit_notes')
        .select('id, credit_note_number, return_date, total_refunded')
        .eq('invoice_id', invoiceId)
        .order('created_at', { ascending: false }),
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
            {creditNotes.length > 0 && (
              <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                Returned
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!invoice.superseded && (
            <Link
              to={`/invoices/${invoice.id}/credit-notes/new`}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100"
            >
              Create Credit Note
            </Link>
          )}
          {invoice.invoice_series === 'non_gst' && !invoice.superseded && (
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
        <PrintHeader label="Invoice" />

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
            <span
              className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                invoice.invoice_series === 'gst'
                  ? 'bg-violet-50 text-violet-600'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {invoice.invoice_series === 'gst' ? 'GST' : 'Non-GST'}
            </span>
          </div>
        </div>

        <div className="mb-8 overflow-hidden rounded-lg border border-slate-300">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <th className="border-r border-slate-300 px-4 py-2.5">Item</th>
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
                      {formatLabel(item.item_type)}
                      {item.serial_imei ? ` · IMEI ${item.serial_imei}` : ''}
                      {item.ram ? ` · ${item.ram}` : ''}
                      {item.storage ? ` · ${item.storage}` : ''}
                    </p>
                    {item.hsn_code && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {item.item_type === 'service' ? 'SAC' : 'HSN'}: {item.hsn_code}
                      </p>
                    )}
                    {item.description && (
                      <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
                    )}
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

      {!invoice.superseded && (
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
    </div>
  )
}
