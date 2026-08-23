import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrencyExact, formatDate, formatLabel } from '../lib/format'

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
  const { membership } = useAuth()

  const [tenantName, setTenantName] = useState('')
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

  useEffect(() => {
    if (!membership) return
    supabase
      .from('tenants')
      .select('name')
      .eq('id', membership.tenantId)
      .single()
      .then(({ data }) => {
        if (data) setTenantName(data.name)
      })
  }, [membership])

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
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {creditNote.credit_note_number}
          </h1>
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          Print / Download
        </button>
      </div>

      {error && (
        <p className="no-print mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}

      <div className="rounded-2xl bg-white p-8 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.12)] print:shadow-none">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-6">
          <div>
            <p className="text-lg font-semibold text-slate-900">{tenantName || 'Credit Note'}</p>
            <p className="mt-1 text-sm text-slate-400">Credit Note</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-500">
              Credit Note No:{' '}
              <span className="font-medium text-slate-900">{creditNote.credit_note_number}</span>
            </p>
            <p className="mt-1 text-sm text-slate-500">Date: {formatDate(creditNote.return_date)}</p>
            {creditNote.invoices && (
              <p className="mt-1 text-sm text-slate-500">
                Against Invoice:{' '}
                <Link
                  to={`/invoices/${creditNote.invoices.id}`}
                  className="no-print font-medium text-slate-900 underline"
                >
                  {creditNote.invoices.invoice_number}
                </Link>
                <span className="hidden print:inline font-medium text-slate-900">
                  {creditNote.invoices.invoice_number}
                </span>
              </p>
            )}
            <span
              className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                creditNote.is_gst ? 'bg-sky-50 text-sky-600' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {creditNote.is_gst ? 'GST' : 'Non-GST'}
            </span>
          </div>
        </div>

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
          <div className="text-right">
            {creditNote.reason && (
              <>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Reason
                </p>
                <p className="whitespace-pre-wrap text-sm text-slate-500">{creditNote.reason}</p>
              </>
            )}
            {creditNote.notes && (
              <>
                <p className="mt-2 mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Notes
                </p>
                <p className="whitespace-pre-wrap text-sm text-slate-500">{creditNote.notes}</p>
              </>
            )}
          </div>
        </div>

        <table className="mb-8 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="py-2 pr-4">Item</th>
              <th className="py-2 pr-4">Qty Returned</th>
              <th className="py-2 pr-4">Unit Price</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {creditNote.items_returned.map((item) => (
              <tr key={item.invoice_item_id} className="border-b border-slate-50">
                <td className="py-2.5 pr-4">
                  <p className="font-medium text-slate-900">{item.item_name}</p>
                  <p className="text-xs text-slate-400">{formatLabel(item.item_type)}</p>
                </td>
                <td className="py-2.5 pr-4 text-slate-500">{item.quantity_returned}</td>
                <td className="py-2.5 pr-4 text-slate-500">{formatCurrencyExact(item.unit_price)}</td>
                <td className="py-2.5 text-right text-slate-700">
                  {formatCurrencyExact(item.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

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
      </div>
    </div>
  )
}
