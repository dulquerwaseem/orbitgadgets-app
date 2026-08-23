import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export interface Customer {
  id: string
  name: string
  phone: string
  address: string | null
  gst_number: string | null
}

interface NewCustomerForm {
  name: string
  phone: string
  address: string
  gst_number: string
}

const emptyNewCustomer: NewCustomerForm = { name: '', phone: '', address: '', gst_number: '' }

interface CustomerPickerProps {
  value: Customer | null
  onChange: (customer: Customer | null) => void
}

export default function CustomerPicker({ value, onChange }: CustomerPickerProps) {
  const { membership } = useAuth()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newCustomer, setNewCustomer] = useState<NewCustomerForm>(emptyNewCustomer)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function loadCustomers() {
    const { data } = await supabase
      .from('customers')
      .select('id, name, phone, address, gst_number')
      .order('name', { ascending: true })
      .limit(500)
    setCustomers(data ?? [])
  }

  useEffect(() => {
    void loadCustomers()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return customers.slice(0, 8)
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q))
      .slice(0, 8)
  }, [customers, search])

  async function handleAddCustomer(e: FormEvent) {
    e.preventDefault()
    if (!membership) return
    setSaving(true)
    setError(null)

    const { data, error } = await supabase
      .from('customers')
      .insert({
        tenant_id: membership.tenantId,
        name: newCustomer.name.trim(),
        phone: newCustomer.phone.trim(),
        address: newCustomer.address.trim() || null,
        gst_number: newCustomer.gst_number.trim() || null,
      })
      .select('id, name, phone, address, gst_number')
      .single()

    setSaving(false)

    if (error || !data) {
      setError(error?.message ?? 'Could not save customer')
      return
    }

    setCustomers((prev) => [data, ...prev])
    setNewCustomer(emptyNewCustomer)
    setShowAddForm(false)
    onChange(data)
  }

  if (value) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-900">{value.name}</p>
            <p className="text-xs text-slate-500">{value.phone}</p>
            {value.address && <p className="mt-0.5 text-xs text-slate-400">{value.address}</p>}
            {value.gst_number && (
              <p className="mt-0.5 text-xs text-slate-400">GST: {value.gst_number}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-200"
          >
            Change
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <input
        type="text"
        placeholder="Search by name or phone"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
      />

      {filtered.length > 0 && (
        <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-slate-100">
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors hover:bg-slate-50"
            >
              <span className="font-medium text-slate-900">{c.name}</span>
              <span className="text-xs text-slate-400">{c.phone}</span>
            </button>
          ))}
        </div>
      )}

      {!showAddForm ? (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="mt-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          + Add new customer
        </button>
      ) : (
        <form onSubmit={handleAddCustomer} className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              required
              placeholder="Name"
              value={newCustomer.name}
              onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
            <input
              type="tel"
              required
              placeholder="Phone"
              value={newCustomer.phone}
              onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </div>
          <input
            type="text"
            placeholder="Address (optional)"
            value={newCustomer.address}
            onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
          <input
            type="text"
            placeholder="GST number (optional)"
            value={newCustomer.gst_number}
            onChange={(e) => setNewCustomer({ ...newCustomer, gst_number: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false)
                setError(null)
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Customer'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
