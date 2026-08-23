import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrencyExact, formatDate } from '../lib/format'

interface CreditNoteRow {
  id: string
  credit_note_number: string
  return_date: string
  total_refunded: number
  invoices: { invoice_number: string } | null
  customers: { name: string } | null
}

export default function CreditNotes() {
  const [creditNotes, setCreditNotes] = useState<CreditNoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadCreditNotes() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('credit_notes')
      .select('id, credit_note_number, return_date, total_refunded, invoices(invoice_number), customers(name)')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      setCreditNotes((data as unknown as CreditNoteRow[]) ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadCreditNotes()
  }, [])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Credit Notes</h1>
        <p className="mt-1 text-sm text-slate-400">{creditNotes.length} credit notes</p>
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}

      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.12)]">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">Loading credit notes…</p>
        ) : creditNotes.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            No credit notes yet. Create one from an invoice's detail view.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-6 py-3">Number</th>
                <th className="px-6 py-3">Invoice</th>
                <th className="px-6 py-3">Customer</th>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Refunded</th>
              </tr>
            </thead>
            <tbody>
              {creditNotes.map((cn) => (
                <tr key={cn.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-0 py-0">
                    <Link to={`/credit-notes/${cn.id}`} className="block px-6 py-3.5 font-medium text-slate-900">
                      {cn.credit_note_number}
                    </Link>
                  </td>
                  <td className="px-6 py-3.5 text-slate-500">{cn.invoices?.invoice_number ?? '—'}</td>
                  <td className="px-6 py-3.5 text-slate-500">{cn.customers?.name ?? '—'}</td>
                  <td className="px-6 py-3.5 text-slate-500">{formatDate(cn.return_date)}</td>
                  <td className="px-6 py-3.5 font-medium text-slate-700">
                    {formatCurrencyExact(cn.total_refunded)}
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
