import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrencyExact, formatLabel } from '../lib/format'

interface VendorOption {
  id: string
  name: string
  gstin: string | null
}

type PurchaseItemType = 'product' | 'spare' | 'other'
type PurchaseKind = 'stock_in_trade' | 'office_expense' | 'capital_asset'
type PaymentStatus = 'unpaid' | 'partial' | 'paid'

const paymentStatusOptions: PaymentStatus[] = ['unpaid', 'partial', 'paid']

interface DraftPurchaseItem {
  key: string
  item_type: PurchaseItemType
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
  serials: string[]
}

const purchaseKindOptions: { value: PurchaseKind; label: string }[] = [
  { value: 'stock_in_trade', label: 'Stock-in-Trade' },
  { value: 'office_expense', label: 'Office Expense' },
  { value: 'capital_asset', label: 'Capital Asset' },
]

const itemTypeLabels: Record<PurchaseItemType, string> = {
  product: 'Product',
  spare: 'Spare Part',
  other: 'Other',
}

interface AddPurchaseItemFormProps {
  editingItem: DraftPurchaseItem | null
  onSave: (item: DraftPurchaseItem) => void
  onCancelEdit: () => void
}

function AddPurchaseItemForm({ editingItem, onSave, onCancelEdit }: AddPurchaseItemFormProps) {
  const [itemType, setItemType] = useState<PurchaseItemType>(editingItem?.item_type ?? 'product')
  const [itemName, setItemName] = useState(editingItem?.item_name ?? '')
  const [brand, setBrand] = useState(editingItem?.brand ?? '')
  const [category, setCategory] = useState(editingItem?.category ?? '')
  const [hsnCode, setHsnCode] = useState(editingItem?.hsn_code ?? '')
  const [description, setDescription] = useState(editingItem?.description ?? '')
  const [ram, setRam] = useState(editingItem?.ram ?? '')
  const [storage, setStorage] = useState(editingItem?.storage ?? '')
  const [condition, setCondition] = useState(editingItem?.condition ?? '')
  const [unitPrice, setUnitPrice] = useState(editingItem ? String(editingItem.unit_price) : '')
  const [quantity, setQuantity] = useState(editingItem ? String(editingItem.quantity) : '1')
  const [gstRate, setGstRate] = useState(editingItem ? String(editingItem.gst_rate) : '18')
  const [serialsText, setSerialsText] = useState(editingItem?.serials.join(', ') ?? '')

  function reset() {
    setItemName('')
    setBrand('')
    setCategory('')
    setHsnCode('')
    setDescription('')
    setRam('')
    setStorage('')
    setCondition('')
    setUnitPrice('')
    setQuantity('1')
    setSerialsText('')
  }

  const canSave = itemName.trim() !== '' && unitPrice !== '' && Number(quantity) > 0

  function handleSave() {
    if (!canSave) return

    const serials = serialsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    onSave({
      key: editingItem?.key ?? crypto.randomUUID(),
      item_type: itemType,
      item_name: itemName.trim(),
      brand: brand.trim() || null,
      category: category.trim() || null,
      hsn_code: hsnCode.trim() || null,
      description: description.trim() || null,
      ram: ram.trim() || null,
      storage: storage.trim() || null,
      condition: condition.trim() || null,
      unit_price: Number(unitPrice),
      quantity: Number(quantity),
      gst_rate: Number(gstRate) || 0,
      serials,
    })

    if (!editingItem) {
      reset()
    }
  }

  return (
    <div
      className={`rounded-xl border p-4 ${
        editingItem ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'
      }`}
    >
      {editingItem && (
        <p className="mb-3 text-xs font-medium text-slate-500">
          Editing "{editingItem.item_name}"
        </p>
      )}
      <div className="mb-3 flex gap-1.5">
        {(Object.keys(itemTypeLabels) as PurchaseItemType[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setItemType(type)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              itemType === type
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-500 hover:text-slate-900'
            }`}
          >
            {itemTypeLabels[type]}
          </button>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <input
          type="text"
          placeholder="Item name"
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
        />
        <input
          type="text"
          placeholder="Brand (optional)"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
        />
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <input
          type="text"
          placeholder="Category (optional)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
        />
        <input
          type="text"
          placeholder="HSN code (optional)"
          value={hsnCode}
          onChange={(e) => setHsnCode(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
        />
      </div>

      {itemType === 'product' && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          <input
            type="text"
            placeholder="RAM (optional)"
            value={ram}
            onChange={(e) => setRam(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
          <input
            type="text"
            placeholder="Storage (optional)"
            value={storage}
            onChange={(e) => setStorage(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
          <input
            type="text"
            placeholder="Condition (optional)"
            value={condition}
            onChange={(e) => setCondition(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </div>
      )}

      <div className="mb-3">
        <textarea
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
        />
      </div>

      {(itemType === 'product' || itemType === 'spare') && (
        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Serials (optional, comma-separated)
          </label>
          <input
            type="text"
            placeholder="e.g. IMEI1, IMEI2"
            value={serialsText}
            onChange={(e) => setSerialsText(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
          {itemType === 'product' && (
            <p className="mt-1 text-xs text-slate-400">
              One product row is created per unit. Serials are assigned in order.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Quantity</label>
          <input
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Unit Price</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">GST %</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={gstRate}
            onChange={(e) => setGstRate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </div>
        <div className="flex gap-2">
          {editingItem && (
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-40"
          >
            {editingItem ? 'Save Changes' : 'Add Item'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function VendorPurchaseNew() {
  const { membership } = useAuth()
  const navigate = useNavigate()
  const isAdmin = membership?.role === 'admin'

  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [vendorId, setVendorId] = useState('')
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [purchaseKind, setPurchaseKind] = useState<PurchaseKind>('stock_in_trade')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<DraftPurchaseItem[]>([])
  const [editingItemKey, setEditingItemKey] = useState<string | null>(null)
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('paid')
  const [amountPaid, setAmountPaid] = useState('')
  const [amountPaidTouched, setAmountPaidTouched] = useState(false)
  const [roundOff, setRoundOff] = useState(false)
  const [vendorActualTotal, setVendorActualTotal] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('vendors')
      .select('id, name, gstin')
      .order('name', { ascending: true })
      .then(({ data }) => setVendors(data ?? []))
  }, [])

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
  const displayGrandTotal = roundOffApplied ? Number(vendorActualTotal) : totals.grandTotal

  const amountPaidDisplay = amountPaidTouched ? amountPaid : displayGrandTotal.toFixed(2)

  async function handleSubmit() {
    if (!membership) return
    setError(null)

    if (!vendorId) {
      setError('Select a vendor before saving.')
      return
    }
    if (items.length === 0) {
      setError('Add at least one line item before saving.')
      return
    }

    setSaving(true)

    const { data, error } = await supabase.rpc('create_vendor_purchase', {
      p_tenant_id: membership.tenantId,
      p_vendor_id: vendorId,
      p_supplier_invoice_no: supplierInvoiceNo.trim() || null,
      p_purchase_date: purchaseDate || null,
      p_purchase_kind: purchaseKind,
      p_notes: notes.trim() || null,
      p_payment_status: paymentStatus,
      p_amount_paid: Number(amountPaidDisplay) || 0,
      p_round_off: roundOffApplied,
      p_vendor_actual_total: roundOffApplied ? Number(vendorActualTotal) : null,
      p_items: items.map((item) => ({
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

    if (error) {
      setError(error.message)
      return
    }

    navigate(`/vendor-purchases/${data.id}`)
  }

  if (!isAdmin) {
    return (
      <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
        Only admins can create vendor purchases.
      </p>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">New Vendor Purchase</h1>
        <p className="mt-1 text-sm text-slate-400">
          Stock-in-trade lines automatically create the corresponding inventory rows.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Purchase Details</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Vendor</label>
                <select
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                >
                  <option value="">Select a vendor…</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-600">
                    Supplier Invoice No.
                  </label>
                  <input
                    type="text"
                    value={supplierInvoiceNo}
                    onChange={(e) => setSupplierInvoiceNo(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-600">
                    Purchase Date
                  </label>
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">
                  Purchase Kind
                </label>
                <div className="flex gap-2">
                  {purchaseKindOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPurchaseKind(opt.value)}
                      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                        purchaseKind === opt.value
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {purchaseKind !== 'stock_in_trade' && (
                  <p className="mt-2 text-xs text-slate-400">
                    This kind does not create inventory rows, even for product/spare lines.
                  </p>
                )}
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
                    {items.map((item) => (
                      <tr key={item.key} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-2.5 font-medium text-slate-900">{item.item_name}</td>
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
                    ))}
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
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Payment</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">
                  Payment Status
                </label>
                <select
                  value={paymentStatus}
                  onChange={(e) => {
                    const next = e.target.value as PaymentStatus
                    setPaymentStatus(next)
                    if (next === 'unpaid') {
                      setAmountPaid('0')
                      setAmountPaidTouched(true)
                    }
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                >
                  {paymentStatusOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {formatLabel(opt)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Amount Paid</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amountPaidDisplay}
                  onChange={(e) => {
                    setAmountPaid(e.target.value)
                    setAmountPaidTouched(true)
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
                />
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Taxable Value</span>
                <span>{formatCurrencyExact(totals.taxableValue)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>GST</span>
                <span>{formatCurrencyExact(totals.gstAmount)}</span>
              </div>
              <label className="flex items-center gap-2 pt-1 text-sm font-medium text-slate-600">
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
                <span>Grand Total</span>
                <span>{formatCurrencyExact(displayGrandTotal)}</span>
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
              {saving ? 'Saving…' : 'Save Purchase'}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
