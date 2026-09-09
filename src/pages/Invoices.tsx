import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrencyExact, formatDate, formatLabel } from '../lib/format'
import DateRangeFilter, { isWithinDateRange } from '../components/DateRangeFilter'
import type { ResolvedDateRange } from '../components/DateRangeFilter'
import type { GstInvoiceExportRow, GstInvoiceItemExportRow } from '../lib/exportGstSales'

interface InvoiceRow {
  id: string
  invoice_number: string
  invoice_series: 'gst' | 'non_gst'
  final_price: number
  payment_status: string
  created_at: string
  void: boolean
  customers: { name: string } | null
}

const paymentStatusStyles: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-600',
  partial: 'bg-amber-50 text-amber-600',
  unpaid: 'bg-red-50 text-red-500',
}

export default function Invoices() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const customerId = searchParams.get('customer')
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<ResolvedDateRange>({ start: null, end: null })
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [showVoid, setShowVoid] = useState(false)

  async function loadInvoices() {
    setLoading(true)
    setError(null)
    let query = supabase
      .from('invoices')
      .select(
        'id, invoice_number, invoice_series, final_price, payment_status, created_at, void, customers(name)',
      )
      .eq('superseded', false)
    if (customerId) query = query.eq('customer_id', customerId)
    if (!showVoid) query = query.eq('void', false)
    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      setInvoices((data as unknown as InvoiceRow[]) ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadInvoices()
  }, [customerId, showVoid])

  const filtered = useMemo(
    () => invoices.filter((invoice) => isWithinDateRange(invoice.created_at, dateRange)),
    [invoices, dateRange],
  )

  const gstInvoiceIds = useMemo(
    () =>
      filtered
        .filter((invoice) => invoice.invoice_series === 'gst' && !invoice.void)
        .map((invoice) => invoice.id),
    [filtered],
  )

  async function handleExport() {
    if (gstInvoiceIds.length === 0) {
      setExportError('No GST invoices in the selected date range.')
      return
    }

    setExporting(true)
    setExportError(null)

    const [{ data: invoiceRows, error: invoiceError }, { data: itemRows, error: itemError }] = await Promise.all([
      supabase
        .from('invoices')
        .select(
          'id, invoice_number, created_at, customer_gst, taxable_value, cgst_amount, sgst_amount, final_price, payment_status, customers(name)',
        )
        .in('id', gstInvoiceIds)
        .order('created_at', { ascending: true }),
      supabase
        .from('invoice_items')
        .select('invoice_id, item_name, hsn_code, item_type, quantity, unit_price, total_price')
        .in('invoice_id', gstInvoiceIds),
    ])

    if (invoiceError || itemError || !invoiceRows) {
      setExporting(false)
      setExportError(invoiceError?.message ?? itemError?.message ?? 'Failed to build the export.')
      return
    }

    const { downloadGstSalesExcel } = await import('../lib/exportGstSales')
    await downloadGstSalesExcel(
      invoiceRows as unknown as GstInvoiceExportRow[],
      (itemRows as unknown as GstInvoiceItemExportRow[]) ?? [],
      dateRange,
    )

    setExporting(false)
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Invoices</h1>
          <p className="mt-1 text-sm text-slate-400">
            {filtered.length} of {invoices.length} invoices
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DateRangeFilter onChange={setDateRange} />
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={showVoid}
              onChange={(e) => setShowVoid(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
            Show void
          </label>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export for CA'}
          </button>
          <Link
            to="/invoices/new"
            className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2 text-sm font-medium transition-opacity"
          >
            New Invoice
          </Link>
        </div>
      </div>

      {customerId && (
        <p className="mb-4 text-sm text-slate-500">
          Filtered to one customer.{' '}
          <Link to="/invoices" className="font-medium text-slate-900 underline">
            Clear filter
          </Link>
        </p>
      )}

      {error && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}
      {exportError && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{exportError}</p>
      )}

      <div className="overflow-hidden rounded-2xl bg-white card-shadow">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">Loading invoices…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {invoices.length === 0 ? 'No invoices yet. Create your first one.' : 'No invoices match this date range.'}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-6 py-3">Number</th>
                <th className="px-6 py-3">Customer</th>
                <th className="px-6 py-3">Series</th>
                <th className="px-6 py-3">Total</th>
                <th className="px-6 py-3">Payment</th>
                <th className="px-6 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((invoice) => (
                <tr
                  key={invoice.id}
                  onClick={() => navigate(`/invoices/${invoice.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/invoices/${invoice.id}`)
                  }}
                  className="cursor-pointer border-b border-slate-50 outline-none last:border-0 hover:bg-slate-50 focus-visible:bg-slate-50 active:bg-slate-100"
                >
                  <td className="px-6 py-3.5 font-medium text-slate-900">
                    {invoice.invoice_number}
                    {invoice.void && (
                      <span className="ml-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                        Void
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3.5 text-slate-500">{invoice.customers?.name ?? '—'}</td>
                  <td className="px-6 py-3.5">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        invoice.invoice_series === 'gst'
                          ? 'bg-violet-50 text-violet-600'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {invoice.invoice_series === 'gst' ? 'GST' : 'Non-GST'}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 font-medium text-slate-700">
                    {formatCurrencyExact(invoice.final_price)}
                  </td>
                  <td className="px-6 py-3.5">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        paymentStatusStyles[invoice.payment_status] ?? 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {formatLabel(invoice.payment_status)}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-slate-500">{formatDate(invoice.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
