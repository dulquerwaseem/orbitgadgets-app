import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatCurrencyExact, formatDate } from '../../lib/format'

interface DebitNoteRow {
  id: string
  purchase_item_id: string | null
  quantity_deducted: number
  adjustment_amount_inclusive_tax: number
  reason: string | null
  description: string | null
  created_at: string
  vendor_purchase_items: { item_name: string } | null
}

interface PurchaseItemOption {
  id: string
  item_name: string
}

interface DebitNotesSectionProps {
  purchaseId: string
  vendorId: string
  items: PurchaseItemOption[]
  isAdmin: boolean
}

export default function DebitNotesSection({
  purchaseId,
  vendorId,
  items,
  isAdmin,
}: DebitNotesSectionProps) {
  const [debitNotes, setDebitNotes] = useState<DebitNoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const [purchaseItemId, setPurchaseItemId] = useState('')
  const [quantityDeducted, setQuantityDeducted] = useState('')
  const [adjustmentAmount, setAdjustmentAmount] = useState('')
  const [reason, setReason] = useState('')
  const [description, setDescription] = useState('')

  async function loadDebitNotes() {
    setLoading(true)
    const { data, error } = await supabase
      .from('vendor_debit_notes')
      .select(
        'id, purchase_item_id, quantity_deducted, adjustment_amount_inclusive_tax, reason, description, created_at, vendor_purchase_items(item_name)',
      )
      .eq('purchase_id', purchaseId)
      .order('created_at', { ascending: false })

    if (error) setError(error.message)
    setDebitNotes((data as unknown as DebitNoteRow[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void loadDebitNotes()
  }, [purchaseId])

  function resetForm() {
    setPurchaseItemId('')
    setQuantityDeducted('')
    setAdjustmentAmount('')
    setReason('')
    setDescription('')
  }

  const canSave =
    purchaseItemId !== '' && Number(quantityDeducted) > 0 && adjustmentAmount !== ''

  async function handleSubmit() {
    if (!canSave) {
      setError('Select a line item, quantity, and adjustment amount.')
      return
    }
    setSaving(true)
    setError(null)

    const { error } = await supabase.from('vendor_debit_notes').insert({
      purchase_id: purchaseId,
      purchase_item_id: purchaseItemId,
      vendor_id: vendorId,
      quantity_deducted: Number(quantityDeducted),
      adjustment_amount_inclusive_tax: Number(adjustmentAmount),
      reason: reason.trim() || null,
      description: description.trim() || null,
    })

    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    resetForm()
    setShowForm(false)
    void loadDebitNotes()
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading debit notes…</p>
      ) : debitNotes.length > 0 ? (
        <div className="mb-4 overflow-hidden rounded-xl border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Qty Deducted</th>
                <th className="px-4 py-2">Reason</th>
                <th className="px-4 py-2 text-right">Adjustment</th>
              </tr>
            </thead>
            <tbody>
              {debitNotes.map((dn) => (
                <tr key={dn.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-slate-900">
                    {dn.vendor_purchase_items?.item_name ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{dn.quantity_deducted}</td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {dn.reason ?? '—'}
                    <span className="ml-2 text-xs text-slate-400">{formatDate(dn.created_at)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-slate-700">
                    −{formatCurrencyExact(dn.adjustment_amount_inclusive_tax)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mb-4 text-sm text-slate-400">No debit notes yet.</p>
      )}

      {isAdmin && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          Create Debit Note
        </button>
      )}

      {isAdmin && showForm && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Line Item</label>
            <select
              value={purchaseItemId}
              onChange={(e) => setPurchaseItemId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            >
              <option value="">Select an item…</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.item_name}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Quantity Deducted
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={quantityDeducted}
                onChange={(e) => setQuantityDeducted(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Adjustment Amount (incl. tax)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={adjustmentAmount}
                onChange={(e) => setAdjustmentAmount(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-slate-500">Reason</label>
            <input
              type="text"
              placeholder="e.g. Damaged unit, short shipment"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Description (optional)
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
              {saving ? 'Saving…' : 'Save Debit Note'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
