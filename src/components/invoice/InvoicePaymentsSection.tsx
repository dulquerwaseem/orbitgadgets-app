import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatCurrencyExact, formatDate, formatLabel } from '../../lib/format'

interface PaymentRow {
  id: string
  amount: number
  payment_date: string
  mode: string | null
  reference_no: string | null
  notes: string | null
}

const modeOptions = ['cash', 'bank_transfer', 'upi', 'cheque', 'other']

interface InvoicePaymentsSectionProps {
  invoiceId: string
  finalPrice: number
  amountPaid: number
  onPaymentRecorded: () => void
}

export default function InvoicePaymentsSection({
  invoiceId,
  finalPrice,
  amountPaid,
  onPaymentRecorded,
}: InvoicePaymentsSectionProps) {
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const [amount, setAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [mode, setMode] = useState('cash')
  const [referenceNo, setReferenceNo] = useState('')
  const [notes, setNotes] = useState('')

  async function loadPayments() {
    setLoading(true)
    const { data, error } = await supabase
      .from('invoice_payments')
      .select('id, amount, payment_date, mode, reference_no, notes')
      .eq('invoice_id', invoiceId)
      .order('payment_date', { ascending: false })

    if (error) setError(error.message)
    setPayments(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void loadPayments()
  }, [invoiceId])

  const balanceDue = finalPrice - amountPaid

  function resetForm() {
    setAmount('')
    setPaymentDate(new Date().toISOString().slice(0, 10))
    setMode('cash')
    setReferenceNo('')
    setNotes('')
  }

  async function handleSubmit() {
    if (!amount || Number(amount) <= 0) {
      setError('Enter a payment amount greater than zero.')
      return
    }
    setSaving(true)
    setError(null)

    const { error } = await supabase.rpc('record_invoice_payment', {
      p_invoice_id: invoiceId,
      p_amount: Number(amount),
      p_payment_date: paymentDate,
      p_mode: mode,
      p_reference_no: referenceNo.trim() || null,
      p_notes: notes.trim() || null,
    })

    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    resetForm()
    setShowForm(false)
    void loadPayments()
    onPaymentRecorded()
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-slate-500">
          Paid {formatCurrencyExact(amountPaid)} of {formatCurrencyExact(finalPrice)}
        </span>
        <span className={`font-semibold ${balanceDue > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
          Balance Due: {formatCurrencyExact(balanceDue)}
        </span>
      </div>

      {error && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading payments…</p>
      ) : payments.length > 0 ? (
        <div className="mb-4 overflow-hidden rounded-xl border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Mode</th>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5 text-slate-500">{formatDate(p.payment_date)}</td>
                  <td className="px-4 py-2.5 text-slate-500">{formatLabel(p.mode)}</td>
                  <td className="px-4 py-2.5 text-slate-500">{p.reference_no ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-slate-700">
                    {formatCurrencyExact(p.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mb-4 text-sm text-slate-400">No payments recorded yet.</p>
      )}

      {balanceDue > 0 && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100"
        >
          Record Payment
        </button>
      )}

      {showForm && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Amount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Payment Date</label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
              />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
              >
                {modeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {formatLabel(opt)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Reference No. (optional)
              </label>
              <input
                type="text"
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-slate-500">Notes (optional)</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false)
                resetForm()
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Payment'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
