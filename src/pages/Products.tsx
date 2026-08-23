import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrency, formatLabel } from '../lib/format'
import Modal from '../components/Modal'

interface Product {
  id: string
  name: string
  category: string | null
  brand: string | null
  condition: string | null
  purchase_price: number | null
  selling_price: number | null
  status: string | null
  description: string | null
  created_at: string
}

interface ProductFormValues {
  name: string
  category: string
  brand: string
  condition: string
  purchase_price: string
  selling_price: string
  status: string
  description: string
}

const emptyForm: ProductFormValues = {
  name: '',
  category: '',
  brand: '',
  condition: 'good',
  purchase_price: '',
  selling_price: '',
  status: 'available',
  description: '',
}

const conditionOptions = ['new', 'like_new', 'good', 'fair', 'poor']
const statusOptions = ['available', 'reserved', 'sold', 'under_repair']

const statusStyles: Record<string, string> = {
  available: 'bg-emerald-50 text-emerald-600',
  reserved: 'bg-amber-50 text-amber-600',
  sold: 'bg-slate-100 text-slate-500',
  under_repair: 'bg-sky-50 text-sky-600',
}

export default function Products() {
  const { membership } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ProductFormValues>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    void loadProducts()
  }, [])

  async function loadProducts() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('products')
      .select('id, name, category, brand, condition, purchase_price, selling_price, status, description, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      setProducts(data ?? [])
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.category ?? '').toLowerCase().includes(q),
    )
  }, [products, search])

  function openAddModal() {
    setEditingId(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEditModal(product: Product) {
    setEditingId(product.id)
    setForm({
      name: product.name,
      category: product.category ?? '',
      brand: product.brand ?? '',
      condition: product.condition ?? 'good',
      purchase_price: product.purchase_price?.toString() ?? '',
      selling_price: product.selling_price?.toString() ?? '',
      status: product.status ?? 'available',
      description: product.description ?? '',
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
      brand: form.brand.trim() || null,
      condition: form.condition || null,
      purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
      selling_price: form.selling_price ? Number(form.selling_price) : null,
      status: form.status || null,
      description: form.description.trim() || null,
    }

    const result = editingId
      ? await supabase.from('products').update(payload).eq('id', editingId)
      : await supabase.from('products').insert({ ...payload, tenant_id: membership.tenantId })

    setSaving(false)

    if (result.error) {
      setFormError(result.error.message)
      return
    }

    setModalOpen(false)
    void loadProducts()
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this product? This cannot be undone.')) return
    const { error } = await supabase.from('products').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setProducts((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Products</h1>
          <p className="mt-1 text-sm text-slate-400">{filtered.length} of {products.length} items</p>
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
            Add Product
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}

      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.12)]">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">Loading products…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {products.length === 0 ? 'No products yet. Add your first one.' : 'No products match your search.'}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Category</th>
                <th className="px-6 py-3">Brand</th>
                <th className="px-6 py-3">Condition</th>
                <th className="px-6 py-3">Purchase</th>
                <th className="px-6 py-3">Selling</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => (
                <tr key={product.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-6 py-3.5 font-medium text-slate-900">{product.name}</td>
                  <td className="px-6 py-3.5 text-slate-500">{product.category ?? '—'}</td>
                  <td className="px-6 py-3.5 text-slate-500">{product.brand ?? '—'}</td>
                  <td className="px-6 py-3.5 text-slate-500">{formatLabel(product.condition)}</td>
                  <td className="px-6 py-3.5 text-slate-500">{formatCurrency(product.purchase_price)}</td>
                  <td className="px-6 py-3.5 text-slate-500">{formatCurrency(product.selling_price)}</td>
                  <td className="px-6 py-3.5">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        statusStyles[product.status ?? ''] ?? 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {formatLabel(product.status)}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => openEditModal(product)}
                        className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void handleDelete(product.id)}
                        className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Edit Product' : 'Add Product'}
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
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Brand</label>
              <input
                type="text"
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              />
            </div>
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Condition</label>
              <select
                value={form.condition}
                onChange={(e) => setForm({ ...form, condition: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              >
                {conditionOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {formatLabel(opt)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              >
                {statusOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {formatLabel(opt)}
                  </option>
                ))}
              </select>
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
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Product'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
