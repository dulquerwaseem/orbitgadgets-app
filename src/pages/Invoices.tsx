import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrencyExact, formatDate, formatLabel } from '../lib/format'

interface InvoiceRow {
  id: string
  invoice_number: string
  invoice_series: 'gst' | 'non_gst'
  final_price: number
  payment_status: string
  created_at: string
  customers: { name: string } | null
}

const paymentStatusStyles: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-600',
  partial: 'bg-amber-50 text-amber-600',
  unpaid: 'bg-red-50 text-red-500',
}

export default function Invoices() {
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadInvoices() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('invoices')
      .select('id, invoice_number, invoice_series, final_price, payment_status, created_at, customers(name)')
      .eq('superseded', false)
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      setInvoices((data as unknown as InvoiceRow[]) ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadInvoices()
  }, [])

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Invoices</h1>
          <p className="mt-1 text-sm text-slate-400">{invoices.length} invoices</p>
        </div>
        <Link
          to="/invoices/new"
          className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2 text-sm font-medium transition-opacity"
        >
          New Invoice
        </Link>
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}

      <div className="overflow-hidden rounded-2xl bg-white card-shadow">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">Loading invoices…</p>
        ) : invoices.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            No invoices yet. Create your first one.
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
              {invoices.map((invoice) => (
                <tr
                  key={invoice.id}
                  onClick={() => navigate(`/invoices/${invoice.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/invoices/${invoice.id}`)
                  }}
                  className="cursor-pointer border-b border-slate-50 outline-none last:border-0 hover:bg-slate-50 focus-visible:bg-slate-50 active:bg-slate-100"
                >
                  <td className="px-6 py-3.5 font-medium text-slate-900">{invoice.invoice_number}</td>
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
