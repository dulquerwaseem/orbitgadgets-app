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

interface PaymentsSectionProps {
  purchaseId: string
  vendorId: string
  grandTotal: number
  isAdmin: boolean
}

export default function PaymentsSection({
  purchaseId,
  vendorId,
  grandTotal,
  isAdmin,
}: PaymentsSectionProps) {
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
      .from('vendor_purchase_payments')
      .select('id, amount, payment_date, mode, reference_no, notes')
      .eq('purchase_id', purchaseId)
      .order('payment_date', { ascending: false })

    if (error) setError(error.message)
    setPayments(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void loadPayments()
  }, [purchaseId])

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0)
  const balance = grandTotal - totalPaid

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

    const { error } = await supabase.from('vendor_purchase_payments').insert({
      purchase_id: purchaseId,
      vendor_id: vendorId,
      amount: Number(amount),
      payment_date: paymentDate,
      mode,
      reference_no: referenceNo.trim() || null,
      notes: notes.trim() || null,
    })

    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    resetForm()
    setShowForm(false)
    void loadPayments()
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-slate-500">
          Paid {formatCurrencyExact(totalPaid)} of {formatCurrencyExact(grandTotal)}
        </span>
        <span className={`font-semibold ${balance > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
          Balance: {formatCurrencyExact(balance)}
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

      {isAdmin && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          Record Payment
        </button>
      )}

      {isAdmin && showForm && (
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
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Notes (optional)
            </label>
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
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Payment'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
