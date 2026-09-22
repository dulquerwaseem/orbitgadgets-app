import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrencyExact } from '../lib/format'
import AddPurchaseItemForm, { itemTypeLabels } from '../components/vendorpurchase/PurchaseItemForm'
import type { DraftPurchaseItem } from '../components/vendorpurchase/PurchaseItemForm'

interface AmendPurchaseData {
  id: string
  purchase_number: string
  purchase_kind: string | null
  round_off: boolean
  grand_total: number
  vendors: { name: string } | null
}

interface ExistingItemRow {
  id: string
  item_type: DraftPurchaseItem['item_type']
  item_name: string
  brand: string | null
  category: string | null
  hsn_code: string | null
  description: string | null
  ram: string | null
  storage: string | null
  condition: string | null
  unit_price: number
  quantity: number
  gst_rate: number
  serials: string[] | null
  product_ids: string[] | null
  spare_part_id: string | null
}

interface ItemHint {
  soldCount: number
  totalUnits: number
  currentSpareQty: number | null
}

export default function VendorPurchaseAmend() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [purchase, setPurchase] = useState<AmendPurchaseData | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [items, setItems] = useState<DraftPurchaseItem[]>([])
  const [editingItemKey, setEditingItemKey] = useState<string | null>(null)
  const [itemHints, setItemHints] = useState<Record<string, ItemHint>>({})

  const [roundOff, setRoundOff] = useState(false)
  const [vendorActualTotal, setVendorActualTotal] = useState('')
  const [reason, setReason] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let active = true

    async function load() {
      setLoading(true)
      setLoadError(null)

      const [{ data: purchaseData, error: purchaseError }, { data: itemsData, error: itemsError }] =
        await Promise.all([
          supabase
            .from('vendor_purchases')
            .select('id, purchase_number, purchase_kind, round_off, grand_total, vendors(name)')
            .eq('id', id)
            .single(),
          supabase
            .from('vendor_purchase_items')
            .select(
              'id, item_type, item_name, brand, category, hsn_code, description, ram, storage, condition, unit_price, quantity, gst_rate, serials, product_ids, spare_part_id',
            )
            .eq('purchase_id', id)
            .order('created_at', { ascending: true }),
        ])

      if (!active) return

      if (purchaseError || !purchaseData) {
        setLoadError(purchaseError?.message ?? 'Purchase not found')
        setLoading(false)
        return
      }
      if (itemsError) {
        setLoadError(itemsError.message)
        setLoading(false)
        return
      }

      const rows = (itemsData ?? []) as ExistingItemRow[]
      const purchaseRow = purchaseData as unknown as AmendPurchaseData

      setPurchase(purchaseRow)
      setRoundOff(purchaseRow.round_off)
      setVendorActualTotal(purchaseRow.round_off ? String(purchaseRow.grand_total) : '')
      setItems(
        rows.map((item) => ({
          key: item.id,
          id: item.id,
          item_type: item.item_type,
          item_name: item.item_name,
          brand: item.brand,
          category: item.category,
          hsn_code: item.hsn_code,
          description: item.description,
          ram: item.ram,
          storage: item.storage,
          condition: item.condition,
          unit_price: item.unit_price,
          quantity: item.quantity,
          gst_rate: item.gst_rate,
          serials: item.serials ?? [],
        })),
      )

      const productIds = rows.flatMap((item) => item.product_ids ?? [])
      const sparePartIds = rows.map((item) => item.spare_part_id).filter((v): v is string => v != null)

      const [{ data: productsData }, { data: sparePartsData }] = await Promise.all([
        productIds.length > 0
          ? supabase.from('products').select('id, status').in('id', productIds)
          : Promise.resolve({ data: [] as { id: string; status: string | null }[] }),
        sparePartIds.length > 0
          ? supabase.from('spare_parts').select('id, quantity').in('id', sparePartIds)
          : Promise.resolve({ data: [] as { id: string; quantity: number }[] }),
      ])

      if (!active) return

      const statusById = new Map((productsData ?? []).map((p) => [p.id, p.status]))
      const spareQtyById = new Map((sparePartsData ?? []).map((s) => [s.id, s.quantity]))

      const hints: Record<string, ItemHint> = {}
      for (const item of rows) {
        if (item.product_ids && item.product_ids.length > 0) {
          const soldCount = item.product_ids.filter((pid) => statusById.get(pid) === 'sold').length
          hints[item.id] = { soldCount, totalUnits: item.product_ids.length, currentSpareQty: null }
        } else if (item.spare_part_id) {
          hints[item.id] = {
            soldCount: 0,
            totalUnits: 0,
            currentSpareQty: spareQtyById.get(item.spare_part_id) ?? null,
          }
        }
      }
      setItemHints(hints)

      setLoading(false)
    }

    void load()
    return () => {
      active = false
    }
  }, [id])

  const editingItem = items.find((item) => item.key === editingItemKey) ?? null

  function removeItem(key: string) {
    setItems((prev) => prev.filter((item) => item.key !== key))
    if (editingItemKey === key) setEditingItemKey(null)
  }

  function handleSaveItem(item: DraftPurchaseItem) {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.key === item.key)
      if (idx === -1) return [...prev, item]
      const next = [...prev]
      next[idx] = item
      return next
    })
    setEditingItemKey(null)
  }

  const totals = useMemo(() => {
    let taxableValue = 0
    let gstAmount = 0
    for (const item of items) {
      const lineTaxable = item.unit_price * item.quantity
      taxableValue += lineTaxable
      gstAmount += Math.round(((lineTaxable * item.gst_rate) / 100) * 100) / 100
    }
    return { taxableValue, gstAmount, grandTotal: taxableValue + gstAmount }
  }, [items])

  const roundOffApplied = roundOff && vendorActualTotal.trim() !== ''
  const roundOffAmount = roundOffApplied ? Number(vendorActualTotal) - totals.grandTotal : 0
  const newGrandTotal = roundOffApplied ? Number(vendorActualTotal) : totals.grandTotal

  async function handleSubmit() {
    if (!id || !purchase) return
    setError(null)

    if (items.length === 0) {
      setError('A purchase must have at least one line item.')
      return
    }
    if (!reason.trim()) {
      setError('A reason is required to amend a vendor purchase.')
      return
    }

    setSaving(true)

    const { error: amendError } = await supabase.rpc('amend_vendor_purchase', {
      p_purchase_id: id,
      p_reason: reason.trim(),
      p_round_off: roundOffApplied,
      p_vendor_actual_total: roundOffApplied ? Number(vendorActualTotal) : null,
      p_items: items.map((item) => ({
        id: item.id,
        item_type: item.item_type,
        item_name: item.item_name,
        brand: item.brand,
        category: item.category,
        hsn_code: item.hsn_code,
        description: item.description,
        ram: item.ram,
        storage: item.storage,
        condition: item.condition,
        unit_price: item.unit_price,
        quantity: item.quantity,
        gst_rate: item.gst_rate,
        serials: item.serials,
      })),
    })

    setSaving(false)

    if (amendError) {
      setError(amendError.message)
      return
    }

    navigate(`/vendor-purchases/${id}`)
  }

  if (loading) {
    return <p className="px-6 py-10 text-center text-sm text-slate-400">Loading purchase…</p>
  }

  if (loadError && !purchase) {
    return <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{loadError}</p>
  }

  if (!purchase) return null

  return (
    <div>
      <div className="mb-6">
        <Link
          to={`/vendor-purchases/${purchase.id}`}
          className="text-sm text-slate-400 hover:text-slate-600"
        >
          ← {purchase.purchase_number}
        </Link>
        <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-slate-900">
          Amend Purchase
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Correct price, quantity, or tax mistakes on {purchase.purchase_number}
          {purchase.vendors?.name ? ` · ${purchase.vendors.name}` : ''}. Reducing or removing a
          stock-in-trade line is blocked if any of its units are already sold or consumed
          elsewhere. This creates a permanent, visible amendment record.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Line Items</h2>

            {items.length > 0 && (
              <div className="mb-4 overflow-hidden rounded-xl border border-slate-100">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-400">
                      <th className="px-4 py-2">Item</th>
                      <th className="px-4 py-2">Type</th>
                      <th className="px-4 py-2">Qty</th>
                      <th className="px-4 py-2">Unit Price</th>
                      <th className="px-4 py-2">GST %</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const hint = item.id ? itemHints[item.id] : undefined
                      return (
                        <tr key={item.key} className="border-b border-slate-50 last:border-0">
                          <td className="px-4 py-2.5 font-medium text-slate-900">
                            {item.item_name}
                            {hint && hint.soldCount > 0 && (
                              <span className="ml-2 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                                {hint.soldCount} of {hint.totalUnits} sold
                              </span>
                            )}
                            {hint && hint.currentSpareQty != null && (
                              <span className="ml-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                                {hint.currentSpareQty} in stock now
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">{itemTypeLabels[item.item_type]}</td>
                          <td className="px-4 py-2.5 text-slate-500">{item.quantity}</td>
                          <td className="px-4 py-2.5 text-slate-500">
                            {formatCurrencyExact(item.unit_price)}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">{item.gst_rate}%</td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => setEditingItemKey(item.key)}
                              className="mr-3 text-xs font-medium text-slate-500 hover:text-slate-900"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => removeItem(item.key)}
                              className="text-xs font-medium text-red-500 hover:text-red-700"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <AddPurchaseItemForm
              key={editingItem?.key ?? 'new-item'}
              editingItem={editingItem}
              onSave={handleSaveItem}
              onCancelEdit={() => setEditingItemKey(null)}
            />
          </section>

          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Round Off</h2>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={roundOff}
                  onChange={(e) => setRoundOff(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                Round off to match vendor bill
              </label>
              {roundOff && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Vendor's Actual Total
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={vendorActualTotal}
                    onChange={(e) => setVendorActualTotal(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                  />
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Reason for Amendment</h2>
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Mistyped unit price on the RAM module line — should be ₹1,200, not ₹1,800"
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </section>
        </div>

        <div className="space-y-6 lg:sticky lg:top-8 lg:self-start">
          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Current Total</span>
                <span>{formatCurrencyExact(purchase.grand_total)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2 text-slate-500">
                <span>Taxable Value</span>
                <span>{formatCurrencyExact(totals.taxableValue)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>GST</span>
                <span>{formatCurrencyExact(totals.gstAmount)}</span>
              </div>
              {roundOffApplied && (
                <div className="flex justify-between text-slate-500">
                  <span>Round Off</span>
                  <span>
                    {roundOffAmount >= 0 ? '+' : '−'}
                    {formatCurrencyExact(Math.abs(roundOffAmount))}
                  </span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
                <span>New Total</span>
                <span>{formatCurrencyExact(newGrandTotal)}</span>
              </div>
            </div>

            {error && (
              <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            )}

            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={saving}
              className="mt-4 w-full rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Amendment'}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
