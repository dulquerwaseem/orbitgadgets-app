import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'

interface Vendor {
  id: string
  name: string
  contact_phone: string | null
  contact_email: string | null
  gstin: string | null
  address: string | null
  notes: string | null
}

interface VendorFormValues {
  name: string
  contact_phone: string
  contact_email: string
  gstin: string
  address: string
  notes: string
}

const emptyForm: VendorFormValues = {
  name: '',
  contact_phone: '',
  contact_email: '',
  gstin: '',
  address: '',
  notes: '',
}

export default function Vendors() {
  const { membership } = useAuth()
  const isAdmin = membership?.role === 'admin'

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<VendorFormValues>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function loadVendors() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('vendors')
      .select('id, name, contact_phone, contact_email, gstin, address, notes')
      .order('name', { ascending: true })

    if (error) {
      setError(error.message)
    } else {
      setVendors(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadVendors()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return vendors
    return vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.contact_phone ?? '').toLowerCase().includes(q) ||
        (v.contact_email ?? '').toLowerCase().includes(q),
    )
  }, [vendors, search])

  function openAddModal() {
    setEditingId(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEditModal(vendor: Vendor) {
    setEditingId(vendor.id)
    setForm({
      name: vendor.name,
      contact_phone: vendor.contact_phone ?? '',
      contact_email: vendor.contact_email ?? '',
      gstin: vendor.gstin ?? '',
      address: vendor.address ?? '',
      notes: vendor.notes ?? '',
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
      contact_phone: form.contact_phone.trim() || null,
      contact_email: form.contact_email.trim() || null,
      gstin: form.gstin.trim() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null,
    }

    const result = editingId
      ? await supabase.from('vendors').update(payload).eq('id', editingId)
      : await supabase.from('vendors').insert({ ...payload, tenant_id: membership.tenantId })

    setSaving(false)

    if (result.error) {
      setFormError(result.error.message)
      return
    }

    setModalOpen(false)
    void loadVendors()
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this vendor? This cannot be undone.')) return
    const { error } = await supabase.from('vendors').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setVendors((prev) => prev.filter((v) => v.id !== id))
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Vendors</h1>
          <p className="mt-1 text-sm text-slate-400">{filtered.length} of {vendors.length} vendors</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search by name, phone, or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400"
          />
          {isAdmin && (
            <button
              onClick={openAddModal}
              className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2 text-sm font-medium transition-opacity"
            >
              Add Vendor
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}

      <div className="overflow-hidden rounded-2xl bg-white card-shadow">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">Loading vendors…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {vendors.length === 0 ? 'No vendors yet. Add your first one.' : 'No vendors match your search.'}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Phone</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">GSTIN</th>
                {isAdmin && <th className="px-6 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((vendor) => (
                <tr key={vendor.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-6 py-3.5 font-medium text-slate-900">{vendor.name}</td>
                  <td className="px-6 py-3.5 text-slate-500">{vendor.contact_phone ?? '—'}</td>
                  <td className="px-6 py-3.5 text-slate-500">{vendor.contact_email ?? '—'}</td>
                  <td className="px-6 py-3.5 text-slate-500">{vendor.gstin ?? '—'}</td>
                  {isAdmin && (
                    <td className="px-6 py-3.5 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEditModal(vendor)}
                          className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void handleDelete(vendor.id)}
                          className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isAdmin && (
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title={editingId ? 'Edit Vendor' : 'Add Vendor'}
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
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Contact Phone</label>
                <input
                  type="text"
                  value={form.contact_phone}
                  onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Contact Email</label>
                <input
                  type="email"
                  value={form.contact_email}
                  onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">GSTIN</label>
              <input
                type="text"
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Address</label>
              <textarea
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">
                Notes (optional)
              </label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
                className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
              >
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Vendor'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
