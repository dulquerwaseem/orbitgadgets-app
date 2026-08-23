import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

export type LineItemType = 'product' | 'spare' | 'service' | 'custom'

export interface DraftItem {
  key: string
  item_type: LineItemType
  product_id: string | null
  spare_part_id: string | null
  item_name: string
  description: string | null
  hsn_code: string | null
  serial_imei: string | null
  ram: string | null
  storage: string | null
  quantity: number
  unit_price: number
  cost_price: number | null
}

interface ProductOption {
  id: string
  name: string
  brand: string | null
  selling_price: number | null
  purchase_price: number | null
  hsn_code: string | null
  serial_imei: string | null
  ram: string | null
  storage: string | null
}

interface SparePartOption {
  id: string
  name: string
  part_number: string | null
  selling_price: number | null
  purchase_price: number | null
  hsn_code: string | null
  quantity: number
}

type EntryMode = 'search' | 'manual'

const typeLabels: Record<LineItemType, string> = {
  product: 'Product',
  spare: 'Spare Part',
  service: 'Service',
  custom: 'Custom',
}

interface LineItemFormProps {
  onAdd: (item: DraftItem) => void
}

export default function LineItemForm({ onAdd }: LineItemFormProps) {
  const [itemType, setItemType] = useState<LineItemType>('service')

  const [products, setProducts] = useState<ProductOption[]>([])
  const [spareParts, setSpareParts] = useState<SparePartOption[]>([])
  const [search, setSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>(null)
  const [selectedSparePart, setSelectedSparePart] = useState<SparePartOption | null>(null)

  const [productEntryMode, setProductEntryMode] = useState<EntryMode>('search')
  const [manualName, setManualName] = useState('')
  const [manualBrand, setManualBrand] = useState('')
  const [manualSerial, setManualSerial] = useState('')
  const [manualRam, setManualRam] = useState('')
  const [manualStorage, setManualStorage] = useState('')

  const [sparePartEntryMode, setSparePartEntryMode] = useState<EntryMode>('search')
  const [manualPartName, setManualPartName] = useState('')
  const [manualPartNumber, setManualPartNumber] = useState('')

  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitPrice, setUnitPrice] = useState('')
  const [description, setDescription] = useState('')
  const [hsnCode, setHsnCode] = useState('')

  async function loadOptions() {
    const [{ data: productData }, { data: spareData }] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, brand, selling_price, purchase_price, hsn_code, serial_imei, ram, storage')
        .or('status.eq.available,status.is.null')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('spare_parts')
        .select('id, name, part_number, selling_price, purchase_price, hsn_code, quantity')
        .order('created_at', { ascending: false })
        .limit(500),
    ])
    setProducts(productData ?? [])
    setSpareParts(spareData ?? [])
  }

  useEffect(() => {
    void loadOptions()
  }, [])

  function resetSelection() {
    setSearch('')
    setSelectedProduct(null)
    setSelectedSparePart(null)
    setProductEntryMode('search')
    setManualName('')
    setManualBrand('')
    setManualSerial('')
    setManualRam('')
    setManualStorage('')
    setSparePartEntryMode('search')
    setManualPartName('')
    setManualPartNumber('')
    setName('')
    setQuantity('1')
    setUnitPrice('')
    setDescription('')
    setHsnCode('')
  }

  function handleTypeChange(next: LineItemType) {
    setItemType(next)
    resetSelection()
  }

  function handleProductEntryModeChange(next: EntryMode) {
    setProductEntryMode(next)
    setSelectedProduct(null)
    setSearch('')
    setManualName('')
    setManualBrand('')
    setManualSerial('')
    setManualRam('')
    setManualStorage('')
    setUnitPrice('')
    setHsnCode('')
  }

  function handleSparePartEntryModeChange(next: EntryMode) {
    setSparePartEntryMode(next)
    setSelectedSparePart(null)
    setSearch('')
    setManualPartName('')
    setManualPartNumber('')
    setUnitPrice('')
    setHsnCode('')
  }

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products.slice(0, 8)
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || (p.brand ?? '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [products, search])

  const filteredSpareParts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return spareParts.slice(0, 8)
    return spareParts
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) || (p.part_number ?? '').toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [spareParts, search])

  function selectProduct(p: ProductOption) {
    setSelectedProduct(p)
    setUnitPrice(p.selling_price?.toString() ?? '')
    setHsnCode(p.hsn_code ?? '')
  }

  function selectSparePart(p: SparePartOption) {
    setSelectedSparePart(p)
    setUnitPrice(p.selling_price?.toString() ?? '')
    setHsnCode(p.hsn_code ?? '')
  }

  const canAdd =
    itemType === 'product'
      ? productEntryMode === 'search'
        ? selectedProduct !== null && unitPrice !== ''
        : manualName.trim() !== '' && unitPrice !== ''
      : itemType === 'spare'
        ? sparePartEntryMode === 'search'
          ? selectedSparePart !== null && unitPrice !== '' && Number(quantity) > 0
          : manualPartName.trim() !== '' && unitPrice !== '' && Number(quantity) > 0
        : name.trim() !== '' && unitPrice !== '' && Number(quantity) > 0

  function handleAdd() {
    if (!canAdd) return

    const trimmedDescription = description.trim() || null
    const trimmedHsnCode = hsnCode.trim() || null
    let draft: DraftItem

    if (itemType === 'product' && productEntryMode === 'search' && selectedProduct) {
      draft = {
        key: crypto.randomUUID(),
        item_type: 'product',
        product_id: selectedProduct.id,
        spare_part_id: null,
        item_name: selectedProduct.name,
        description: trimmedDescription,
        hsn_code: trimmedHsnCode,
        serial_imei: selectedProduct.serial_imei,
        ram: selectedProduct.ram,
        storage: selectedProduct.storage,
        quantity: 1,
        unit_price: Number(unitPrice),
        cost_price: selectedProduct.purchase_price,
      }
    } else if (itemType === 'product' && productEntryMode === 'manual') {
      const trimmedBrand = manualBrand.trim()
      const trimmedName = manualName.trim()
      draft = {
        key: crypto.randomUUID(),
        item_type: 'product',
        product_id: null,
        spare_part_id: null,
        item_name: trimmedBrand ? `${trimmedBrand} ${trimmedName}` : trimmedName,
        description: trimmedDescription,
        hsn_code: trimmedHsnCode,
        serial_imei: manualSerial.trim() || null,
        ram: manualRam.trim() || null,
        storage: manualStorage.trim() || null,
        quantity: 1,
        unit_price: Number(unitPrice),
        cost_price: null,
      }
    } else if (itemType === 'spare' && sparePartEntryMode === 'search' && selectedSparePart) {
      draft = {
        key: crypto.randomUUID(),
        item_type: 'spare',
        product_id: null,
        spare_part_id: selectedSparePart.id,
        item_name: selectedSparePart.name,
        description: trimmedDescription,
        hsn_code: trimmedHsnCode,
        serial_imei: null,
        ram: null,
        storage: null,
        quantity: Number(quantity),
        unit_price: Number(unitPrice),
        cost_price: selectedSparePart.purchase_price,
      }
    } else if (itemType === 'spare' && sparePartEntryMode === 'manual') {
      draft = {
        key: crypto.randomUUID(),
        item_type: 'spare',
        product_id: null,
        spare_part_id: null,
        item_name: manualPartName.trim(),
        description: trimmedDescription,
        hsn_code: trimmedHsnCode,
        serial_imei: null,
        ram: null,
        storage: null,
        quantity: Number(quantity),
        unit_price: Number(unitPrice),
        cost_price: null,
      }
    } else {
      draft = {
        key: crypto.randomUUID(),
        item_type: itemType,
        product_id: null,
        spare_part_id: null,
        item_name: name.trim(),
        description: trimmedDescription,
        hsn_code: itemType === 'service' ? trimmedHsnCode : null,
        serial_imei: null,
        ram: null,
        storage: null,
        quantity: Number(quantity),
        unit_price: Number(unitPrice),
        cost_price: null,
      }
    }

    onAdd(draft)
    resetSelection()
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex gap-1.5">
        {(Object.keys(typeLabels) as LineItemType[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => handleTypeChange(type)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              itemType === type
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-500 hover:text-slate-900'
            }`}
          >
            {typeLabels[type]}
          </button>
        ))}
      </div>

      {itemType === 'product' && (
        <div className="mb-3 flex gap-1.5">
          <button
            type="button"
            onClick={() => handleProductEntryModeChange('search')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              productEntryMode === 'search'
                ? 'bg-slate-200 text-slate-900'
                : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            Search Existing
          </button>
          <button
            type="button"
            onClick={() => handleProductEntryModeChange('manual')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              productEntryMode === 'manual'
                ? 'bg-slate-200 text-slate-900'
                : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            Enter Manually
          </button>
        </div>
      )}

      {itemType === 'product' &&
        productEntryMode === 'search' &&
        (selectedProduct ? (
          <div className="mb-3 flex items-center justify-between rounded-lg bg-white px-3 py-2">
            <div>
              <p className="text-sm font-medium text-slate-900">{selectedProduct.name}</p>
              <p className="text-xs text-slate-400">{selectedProduct.brand ?? '—'}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedProduct(null)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="mb-3">
            <input
              type="text"
              placeholder="Search products by name or brand"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
            {filteredProducts.length > 0 && (
              <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-slate-100 bg-white">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectProduct(p)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-900">{p.name}</span>
                    <span className="text-xs text-slate-400">
                      {p.selling_price ? `₹${p.selling_price}` : '—'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

      {itemType === 'product' && productEntryMode === 'manual' && (
        <div className="mb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              required
              placeholder="Item name"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
            <input
              type="text"
              placeholder="Brand (optional)"
              value={manualBrand}
              onChange={(e) => setManualBrand(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="Serial/IMEI (optional)"
              value={manualSerial}
              onChange={(e) => setManualSerial(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
            <input
              type="text"
              placeholder="RAM (optional)"
              value={manualRam}
              onChange={(e) => setManualRam(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
            <input
              type="text"
              placeholder="Storage (optional)"
              value={manualStorage}
              onChange={(e) => setManualStorage(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </div>
        </div>
      )}

      {itemType === 'spare' && (
        <div className="mb-3 flex gap-1.5">
          <button
            type="button"
            onClick={() => handleSparePartEntryModeChange('search')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              sparePartEntryMode === 'search'
                ? 'bg-slate-200 text-slate-900'
                : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            Search Existing
          </button>
          <button
            type="button"
            onClick={() => handleSparePartEntryModeChange('manual')}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              sparePartEntryMode === 'manual'
                ? 'bg-slate-200 text-slate-900'
                : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            Enter Manually
          </button>
        </div>
      )}

      {itemType === 'spare' &&
        sparePartEntryMode === 'search' &&
        (selectedSparePart ? (
          <div className="mb-3 flex items-center justify-between rounded-lg bg-white px-3 py-2">
            <div>
              <p className="text-sm font-medium text-slate-900">{selectedSparePart.name}</p>
              <p className="text-xs text-slate-400">In stock: {selectedSparePart.quantity}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedSparePart(null)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="mb-3">
            <input
              type="text"
              placeholder="Search spare parts by name or part number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
            {filteredSpareParts.length > 0 && (
              <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-slate-100 bg-white">
                {filteredSpareParts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectSparePart(p)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-900">{p.name}</span>
                    <span className="text-xs text-slate-400">Stock: {p.quantity}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

      {itemType === 'spare' && sparePartEntryMode === 'manual' && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <input
            type="text"
            required
            placeholder="Part name"
            value={manualPartName}
            onChange={(e) => setManualPartName(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
          <input
            type="text"
            placeholder="Part number (optional)"
            value={manualPartNumber}
            onChange={(e) => setManualPartNumber(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </div>
      )}

      {(itemType === 'service' || itemType === 'custom') && (
        <div className="mb-3">
          <input
            type="text"
            placeholder={itemType === 'service' ? 'e.g. CMOS Battery Replacement' : 'e.g. Phone Cover'}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </div>
      )}

      {itemType !== 'custom' && (
        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-slate-500">
            {itemType === 'service' ? 'SAC Code' : 'HSN Code'}
          </label>
          <input
            type="text"
            placeholder="Optional"
            value={hsnCode}
            onChange={(e) => setHsnCode(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
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

      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Quantity</label>
          <input
            type="number"
            min="1"
            step="1"
            disabled={itemType === 'product'}
            value={itemType === 'product' ? '1' : quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 disabled:bg-slate-100 disabled:text-slate-400"
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
        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Add Item
        </button>
      </div>
    </div>
  )
}
