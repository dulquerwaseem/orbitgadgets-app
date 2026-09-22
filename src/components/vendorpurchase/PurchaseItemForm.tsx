import { useState } from 'react'

export type PurchaseItemType = 'product' | 'spare' | 'other'

export interface DraftPurchaseItem {
  key: string
  id: string | null
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

export const itemTypeLabels: Record<PurchaseItemType, string> = {
  product: 'Product',
  spare: 'Spare Part',
  other: 'Other',
}

interface AddPurchaseItemFormProps {
  editingItem: DraftPurchaseItem | null
  onSave: (item: DraftPurchaseItem) => void
  onCancelEdit: () => void
}

export default function AddPurchaseItemForm({
  editingItem,
  onSave,
  onCancelEdit,
}: AddPurchaseItemFormProps) {
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
      id: editingItem?.id ?? null,
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
            disabled={editingItem?.id != null && type !== editingItem.item_type}
            onClick={() => setItemType(type)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              itemType === type
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-500 hover:text-slate-900'
            }`}
          >
            {itemTypeLabels[type]}
          </button>
        ))}
      </div>
      {editingItem?.id != null && (
        <p className="mb-3 text-xs text-slate-400">
          Type is locked for an existing line — remove it and add a new line to change type.
        </p>
      )}

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
