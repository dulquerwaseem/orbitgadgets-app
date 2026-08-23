import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrency } from '../lib/format'
import Modal from '../components/Modal'

interface SparePart {
  id: string
  name: string
  category: string | null
  part_number: string | null
  quantity: number
  reorder_level: number | null
  purchase_price: number | null
  selling_price: number | null
  description: string | null
  created_at: string
}

interface SparePartFormValues {
  name: string
  category: string
  part_number: string
  quantity: string
  reorder_level: string
  purchase_price: string
  selling_price: string
  description: string
}

const emptyForm: SparePartFormValues = {
  name: '',
  category: '',
  part_number: '',
  quantity: '0',
  reorder_level: '',
  purchase_price: '',
  selling_price: '',
  description: '',
}

function isLowStock(part: SparePart) {
  return part.reorder_level !== null && part.quantity <= part.reorder_level
}

export default function SpareParts() {
  const { membership } = useAuth()
  const [parts, setParts] = useState<SparePart[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<SparePartFormValues>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    void loadParts()
  }, [])

  async function loadParts() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('spare_parts')
      .select(
        'id, name, category, part_number, quantity, reorder_level, purchase_price, selling_price, description, created_at',
      )
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      setParts(data ?? [])
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return parts
    return parts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.category ?? '').toLowerCase().includes(q),
    )
  }, [parts, search])

  function openAddModal() {
    setEditingId(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEditModal(part: SparePart) {
    setEditingId(part.id)
    setForm({
      name: part.name,
      category: part.category ?? '',
      part_number: part.part_number ?? '',
      quantity: part.quantity.toString(),
      reorder_level: part.reorder_level?.toString() ?? '',
      purchase_price: part.purchase_price?.toString() ?? '',
      selling_price: part.selling_price?.toString() ?? '',
      description: part.description ?? '',
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!membership) return

    setSaving(true)
    setFormError(null)

    const payload = {
      name: form.name.trim(),
      category: form.category.trim() || null,
      part_number: form.part_number.trim() || null,
      quantity: form.quantity ? Number(form.quantity) : 0,
      reorder_level: form.reorder_level ? Number(form.reorder_level) : null,
      purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
      selling_price: form.selling_price ? Number(form.selling_price) : null,
      description: form.description.trim() || null,
    }

    const result = editingId
      ? await supabase.from('spare_parts').update(payload).eq('id', editingId)
      : await supabase.from('spare_parts').insert({ ...payload, tenant_id: membership.tenantId })

    setSaving(false)

    if (result.error) {
      setFormError(result.error.message)
      return
    }

    setModalOpen(false)
    void loadParts()
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this spare part? This cannot be undone.')) return
    const { error } = await supabase.from('spare_parts').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setParts((prev) => prev.filter((p) => p.id !== id))
  }

  const lowStockCount = useMemo(() => parts.filter(isLowStock).length, [parts])

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Spare Parts</h1>
          <p className="mt-1 text-sm text-slate-400">
            {filtered.length} of {parts.length} items
            {lowStockCount > 0 && (
              <span className="ml-2 text-amber-600">· {lowStockCount} low stock</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search by name or category"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400"
          />
          <button
            onClick={openAddModal}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Add Spare Part
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}

      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.12)]">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">Loading spare parts…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {parts.length === 0 ? 'No spare parts yet. Add your first one.' : 'No spare parts match your search.'}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Category</th>
                <th className="px-6 py-3">Part #</th>
                <th className="px-6 py-3">Quantity</th>
                <th className="px-6 py-3">Reorder Level</th>
                <th className="px-6 py-3">Purchase</th>
                <th className="px-6 py-3">Selling</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((part) => {
                const lowStock = isLowStock(part)
                return (
                  <tr
                    key={part.id}
                    className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/60 ${
                      lowStock ? 'bg-amber-50/60' : ''
                    }`}
                  >
                    <td className="px-6 py-3.5 font-medium text-slate-900">
                      <div className="flex items-center gap-2">
                        {part.name}
                        {lowStock && (
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                            Low stock
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-slate-500">{part.category ?? '—'}</td>
                    <td className="px-6 py-3.5 text-slate-500">{part.part_number ?? '—'}</td>
                    <td
                      className={`px-6 py-3.5 font-medium ${lowStock ? 'text-amber-700' : 'text-slate-700'}`}
                    >
                      {part.quantity}
                    </td>
                    <td className="px-6 py-3.5 text-slate-500">{part.reorder_level ?? '—'}</td>
                    <td className="px-6 py-3.5 text-slate-500">{formatCurrency(part.purchase_price)}</td>
                    <td className="px-6 py-3.5 text-slate-500">{formatCurrency(part.selling_price)}</td>
                    <td className="px-6 py-3.5 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEditModal(part)}
                          className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void handleDelete(part.id)}
                          className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Edit Spare Part' : 'Add Spare Part'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Name</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Category</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Part Number</label>
              <input
                type="text"
                value={form.part_number}
                onChange={(e) => setForm({ ...form, part_number: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Quantity</label>
              <input
                type="number"
                min="0"
                step="1"
                required
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Reorder Level</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.reorder_level}
                onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">
              Description (optional)
            </label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Purchase Price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.purchase_price}
                onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Selling Price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.selling_price}
                onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              />
            </div>
          </div>

          {formError && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Spare Part'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
