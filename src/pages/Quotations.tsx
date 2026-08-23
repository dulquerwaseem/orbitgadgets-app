import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrencyExact, formatDate, formatLabel } from '../lib/format'

interface QuotationRow {
  id: string
  quotation_number: string
  invoice_series: 'gst' | 'non_gst'
  total: number
  valid_until: string | null
  status: string
  customers: { name: string } | null
}

const statusStyles: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-500',
  converted: 'bg-emerald-50 text-emerald-600',
}

export default function Quotations() {
  const [quotations, setQuotations] = useState<QuotationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadQuotations() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('quotations')
      .select('id, quotation_number, invoice_series, total, valid_until, status, customers(name)')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      setQuotations((data as unknown as QuotationRow[]) ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadQuotations()
  }, [])

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Quotations</h1>
          <p className="mt-1 text-sm text-slate-400">{quotations.length} quotations</p>
        </div>
        <Link
          to="/quotations/new"
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          New Quotation
        </Link>
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}

      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.12)]">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">Loading quotations…</p>
        ) : quotations.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            No quotations yet. Create your first one.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-6 py-3">Number</th>
                <th className="px-6 py-3">Customer</th>
                <th className="px-6 py-3">Series</th>
                <th className="px-6 py-3">Total</th>
                <th className="px-6 py-3">Valid Until</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {quotations.map((quotation) => (
                <tr key={quotation.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-0 py-0">
                    <Link
                      to={`/quotations/${quotation.id}`}
                      className="block px-6 py-3.5 font-medium text-slate-900"
                    >
                      {quotation.quotation_number}
                    </Link>
                  </td>
                  <td className="px-6 py-3.5 text-slate-500">{quotation.customers?.name ?? '—'}</td>
                  <td className="px-6 py-3.5">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        quotation.invoice_series === 'gst'
                          ? 'bg-sky-50 text-sky-600'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {quotation.invoice_series === 'gst' ? 'GST' : 'Non-GST'}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 font-medium text-slate-700">
                    {formatCurrencyExact(quotation.total)}
                  </td>
                  <td className="px-6 py-3.5 text-slate-500">{formatDate(quotation.valid_until)}</td>
                  <td className="px-6 py-3.5">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        statusStyles[quotation.status] ?? 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {formatLabel(quotation.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
