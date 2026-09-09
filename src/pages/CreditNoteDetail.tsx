import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrencyExact, formatDate, formatLabel } from '../lib/format'
import PrintHeader from '../components/print/PrintHeader'
import PrintFooter from '../components/print/PrintFooter'

interface ReturnedItem {
  invoice_item_id: string
  item_type: string
  item_name: string
  quantity_returned: number
  unit_price: number
  line_total: number
}

interface CreditNoteData {
  id: string
  credit_note_number: string
  is_gst: boolean
  return_date: string
  reason: string | null
  notes: string | null
  items_returned: ReturnedItem[]
  subtotal: number
  taxable_value: number
  cgst: number
  sgst: number
  total_refunded: number
  invoices: { id: string; invoice_number: string } | null
  customers: { name: string; phone: string; address: string | null } | null
}

export default function CreditNoteDetail() {
  const { id } = useParams<{ id: string }>()

  const [creditNote, setCreditNote] = useState<CreditNoteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadCreditNote(creditNoteId: string) {
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('credit_notes')
      .select('*, invoices(id, invoice_number), customers(name, phone, address)')
      .eq('id', creditNoteId)
      .single()

    if (error || !data) {
      setError(error?.message ?? 'Credit note not found')
      setLoading(false)
      return
    }

    setCreditNote(data as unknown as CreditNoteData)
    setLoading(false)
  }

  useEffect(() => {
    if (id) void loadCreditNote(id)
  }, [id])

  if (loading) {
    return <p className="px-6 py-10 text-center text-sm text-slate-400">Loading credit note…</p>
  }

  if (error && !creditNote) {
    return <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
  }

  if (!creditNote) return null

  return (
    <div>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/credit-notes" className="text-sm text-slate-400 hover:text-slate-600">
            ← All Credit Notes
          </Link>
          <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-slate-900">
            {creditNote.credit_note_number}
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
        <PrintHeader label="Credit Note" />

        <div className="mb-8 grid grid-cols-2 gap-6">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              Customer
            </p>
            <p className="text-sm font-medium text-slate-900">{creditNote.customers?.name ?? '—'}</p>
            <p className="text-sm text-slate-500">{creditNote.customers?.phone}</p>
            {creditNote.customers?.address && (
              <p className="text-sm text-slate-500">{creditNote.customers.address}</p>
            )}
          </div>
          <div className="text-right text-sm text-slate-500">
            <p>
              Credit Note No:{' '}
              <span className="font-semibold text-slate-900">{creditNote.credit_note_number}</span>
            </p>
            <p className="mt-1">Date: {formatDate(creditNote.return_date)}</p>
            {creditNote.invoices && (
              <p className="mt-1">
                Against Invoice:{' '}
                <Link
                  to={`/invoices/${creditNote.invoices.id}`}
                  className="no-print font-medium text-slate-900 underline"
                >
                  {creditNote.invoices.invoice_number}
                </Link>
                <span className="hidden font-medium text-slate-900 print:inline">
                  {creditNote.invoices.invoice_number}
                </span>
              </p>
            )}
            {creditNote.reason && (
              <>
                <p className="mt-2 mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Reason
                </p>
                <p className="whitespace-pre-wrap">{creditNote.reason}</p>
              </>
            )}
            {creditNote.notes && (
              <>
                <p className="mt-2 mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Notes
                </p>
                <p className="whitespace-pre-wrap">{creditNote.notes}</p>
              </>
            )}
            <span
              className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                creditNote.is_gst ? 'bg-violet-50 text-violet-600' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {creditNote.is_gst ? 'GST' : 'Non-GST'}
            </span>
          </div>
        </div>

        <div className="mb-8 overflow-hidden rounded-lg border border-slate-300">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <th className="border-r border-slate-300 px-4 py-2.5">Item</th>
                <th className="border-r border-slate-300 px-4 py-2.5">Qty Returned</th>
                <th className="border-r border-slate-300 px-4 py-2.5">Unit Price</th>
                <th className="px-4 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {creditNote.items_returned.map((item, index) => (
                <tr
                  key={item.invoice_item_id}
                  className={`border-b border-slate-200 last:border-b-0 ${
                    index % 2 === 1 ? 'bg-slate-50' : 'bg-white'
                  }`}
                >
                  <td className="border-r border-slate-200 px-4 py-2.5">
                    <p className="font-medium text-slate-900">{item.item_name}</p>
                    <p className="no-print text-xs text-slate-400">{formatLabel(item.item_type)}</p>
                  </td>
                  <td className="border-r border-slate-200 px-4 py-2.5 text-slate-500">
                    {item.quantity_returned}
                  </td>
                  <td className="border-r border-slate-200 px-4 py-2.5 text-slate-500">
                    {formatCurrencyExact(item.unit_price)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-700">
                    {formatCurrencyExact(item.line_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between border-t border-slate-100 pt-2 font-medium text-slate-700">
              <span>Subtotal</span>
              <span>{formatCurrencyExact(creditNote.subtotal)}</span>
            </div>
            {creditNote.is_gst && (
              <>
                <div className="flex justify-between text-slate-500">
                  <span>CGST (9%)</span>
                  <span>{formatCurrencyExact(creditNote.cgst)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>SGST (9%)</span>
                  <span>{formatCurrencyExact(creditNote.sgst)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
              <span>Total Refunded</span>
              <span>{formatCurrencyExact(creditNote.total_refunded)}</span>
            </div>
          </div>
        </div>

        <PrintFooter note="This is a system-generated credit note." />
      </div>
    </div>
  )
}
