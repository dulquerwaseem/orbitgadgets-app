import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrencyExact } from '../lib/format'

interface InvoiceSummary {
  id: string
  invoice_number: string
  invoice_series: 'gst' | 'non_gst'
  superseded: boolean
  customers: { name: string } | null
}

interface InvoiceItemRow {
  id: string
  item_name: string
  quantity: number
  unit_price: number
}

interface ReturnedItemRecord {
  invoice_item_id: string
  quantity_returned: number
}

export default function CreditNoteNew() {
  const { invoiceId } = useParams<{ invoiceId: string }>()
  const { membership } = useAuth()
  const navigate = useNavigate()

  const [invoice, setInvoice] = useState<InvoiceSummary | null>(null)
  const [items, setItems] = useState<InvoiceItemRow[]>([])
  const [alreadyReturned, setAlreadyReturned] = useState<Record<string, number>>({})
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadInvoice(id: string) {
    setLoading(true)
    setError(null)

    const [
      { data: invoiceData, error: invoiceError },
      { data: itemsData, error: itemsError },
      { data: creditNoteData },
    ] = await Promise.all([
      supabase
        .from('invoices')
        .select('id, invoice_number, invoice_series, superseded, customers(name)')
        .eq('id', id)
        .single(),
      supabase
        .from('invoice_items')
        .select('id, item_name, quantity, unit_price')
        .eq('invoice_id', id)
        .order('created_at', { ascending: true }),
      supabase.from('credit_notes').select('items_returned').eq('invoice_id', id),
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

    const returnedMap: Record<string, number> = {}
    for (const cn of creditNoteData ?? []) {
      const records = (cn.items_returned ?? []) as ReturnedItemRecord[]
      for (const record of records) {
        returnedMap[record.invoice_item_id] =
          (returnedMap[record.invoice_item_id] ?? 0) + Number(record.quantity_returned)
      }
    }

    setInvoice(invoiceData as unknown as InvoiceSummary)
    setItems(itemsData ?? [])
    setAlreadyReturned(returnedMap)
    setLoading(false)
  }

  useEffect(() => {
    if (invoiceId) void loadInvoice(invoiceId)
  }, [invoiceId])

  function remainingFor(item: InvoiceItemRow) {
    return item.quantity - (alreadyReturned[item.id] ?? 0)
  }

  function setReturnQuantity(itemId: string, value: string) {
    setReturnQuantities((prev) => ({ ...prev, [itemId]: value }))
  }

  const selectedItems = useMemo(
    () =>
      items
        .map((item) => ({ item, quantity: Number(returnQuantities[item.id]) || 0 }))
        .filter(({ quantity }) => quantity > 0),
    [items, returnQuantities],
  )

  const subtotal = useMemo(
    () => selectedItems.reduce((sum, { item, quantity }) => sum + item.unit_price * quantity, 0),
    [selectedItems],
  )
  const isGst = invoice?.invoice_series === 'gst'
  const cgst = isGst ? Math.round(subtotal * 0.09 * 100) / 100 : 0
  const sgst = isGst ? Math.round(subtotal * 0.09 * 100) / 100 : 0
  const totalRefunded = subtotal + cgst + sgst

  async function handleSubmit() {
    if (!membership || !invoice) return
    setError(null)

    if (selectedItems.length === 0) {
      setError('Enter a return quantity for at least one item.')
      return
    }
    if (!reason.trim()) {
      setError('Enter a reason for the return.')
      return
    }

    setSaving(true)

    const { data, error } = await supabase.rpc('create_credit_note', {
      p_tenant_id: membership.tenantId,
      p_invoice_id: invoice.id,
      p_reason: reason.trim(),
      p_notes: notes.trim() || null,
      p_items: selectedItems.map(({ item, quantity }) => ({
        invoice_item_id: item.id,
        quantity_returned: quantity,
      })),
    })

    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    navigate(`/credit-notes/${data.id}`)
  }

  if (loading) {
    return <p className="px-6 py-10 text-center text-sm text-slate-400">Loading invoice…</p>
  }

  if (error && !invoice) {
    return <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
  }

  if (!invoice) return null

  return (
    <div>
      <div className="mb-6">
        <Link to={`/invoices/${invoice.id}`} className="text-sm text-slate-400 hover:text-slate-600">
          ← {invoice.invoice_number}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          Create Credit Note
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Against {invoice.invoice_number}
          {invoice.customers?.name ? ` · ${invoice.customers.name}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.12)]">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Items to Return</h2>
            <div className="overflow-hidden rounded-xl border border-slate-100">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2">Sold Qty</th>
                    <th className="px-4 py-2">Remaining</th>
                    <th className="px-4 py-2">Unit Price</th>
                    <th className="px-4 py-2">Return Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const remaining = remainingFor(item)
                    return (
                      <tr key={item.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-2.5 font-medium text-slate-900">{item.item_name}</td>
                        <td className="px-4 py-2.5 text-slate-500">{item.quantity}</td>
                        <td className="px-4 py-2.5 text-slate-500">{remaining}</td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {formatCurrencyExact(item.unit_price)}
                        </td>
                        <td className="px-4 py-2.5">
                          <input
                            type="number"
                            min="0"
                            max={remaining}
                            step="1"
                            disabled={remaining <= 0}
                            value={returnQuantities[item.id] ?? ''}
                            onChange={(e) => setReturnQuantity(item.id, e.target.value)}
                            placeholder="0"
                            className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-400"
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.12)]">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Details</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Reason</label>
                <textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Customer changed their mind, defective part, wrong item"
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">
                  Notes (optional)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                />
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.12)]">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Refund Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Items Returned</span>
                <span>{selectedItems.length}</span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2 font-medium text-slate-700">
                <span>Subtotal</span>
                <span>{formatCurrencyExact(subtotal)}</span>
              </div>
              {isGst && (
                <>
                  <div className="flex justify-between text-slate-500">
                    <span>CGST (9%)</span>
                    <span>{formatCurrencyExact(cgst)}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>SGST (9%)</span>
                    <span>{formatCurrencyExact(sgst)}</span>
                  </div>
                </>
              )}
              <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
                <span>Total Refund</span>
                <span>{formatCurrencyExact(totalRefunded)}</span>
              </div>
            </div>

            {error && (
              <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            )}

            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving}
              className="mt-4 w-full rounded-xl bg-slate-900 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Credit Note'}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
