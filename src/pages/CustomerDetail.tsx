import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrencyExact, formatDate, formatLabel } from '../lib/format'

interface CustomerData {
  id: string
  name: string
  phone: string
  address: string | null
  gst_number: string | null
  notes: string | null
}

interface CustomerFormValues {
  name: string
  phone: string
  address: string
  gst_number: string
  notes: string
}

interface InvoiceHistoryRow {
  id: string
  invoice_number: string
  created_at: string
  final_price: number
  payment_status: string
}

interface JobSheetHistoryRow {
  id: string
  job_number: string
  device_name: string | null
  device_brand: string | null
  status: string
}

interface QuotationHistoryRow {
  id: string
  quotation_number: string
  created_at: string
  status: string
}

const HISTORY_LIMIT = 10

const paymentStatusStyles: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-600',
  partial: 'bg-amber-50 text-amber-600',
  unpaid: 'bg-red-50 text-red-500',
}

const jobSheetStatusStyles: Record<string, string> = {
  intake: 'bg-slate-100 text-slate-500',
  in_progress: 'bg-sky-50 text-sky-600',
  ready: 'bg-amber-50 text-amber-700',
  delivered: 'bg-emerald-50 text-emerald-600',
}

const quotationStatusStyles: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-500',
  converted: 'bg-emerald-50 text-emerald-600',
}

function pluralize(n: number, singular: string): string {
  return `${n} ${singular}${n === 1 ? '' : 's'}`
}

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { membership } = useAuth()
  const isAdmin = membership?.role === 'admin'

  const [customer, setCustomer] = useState<CustomerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<CustomerFormValues>({
    name: '',
    phone: '',
    address: '',
    gst_number: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [invoices, setInvoices] = useState<InvoiceHistoryRow[]>([])
  const [jobSheets, setJobSheets] = useState<JobSheetHistoryRow[]>([])
  const [quotations, setQuotations] = useState<QuotationHistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function loadCustomer(customerId: string) {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('customers')
      .select('id, name, phone, address, gst_number, notes')
      .eq('id', customerId)
      .single()

    if (error || !data) {
      setError(error?.message ?? 'Customer not found')
      setLoading(false)
      return
    }

    setCustomer(data)
    setForm({
      name: data.name,
      phone: data.phone,
      address: data.address ?? '',
      gst_number: data.gst_number ?? '',
      notes: data.notes ?? '',
    })
    setLoading(false)
  }

  async function loadHistory(customerId: string) {
    setHistoryLoading(true)

    const [{ data: invoiceRows }, { data: jobSheetRows }, { data: quotationRows }] = await Promise.all([
      supabase
        .from('invoices')
        .select('id, invoice_number, created_at, final_price, payment_status')
        .eq('customer_id', customerId)
        .eq('superseded', false)
        .eq('void', false)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT + 1),
      supabase
        .from('job_sheets')
        .select('id, job_number, device_name, device_brand, status')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT + 1),
      supabase
        .from('quotations')
        .select('id, quotation_number, created_at, status')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT + 1),
    ])

    setInvoices(invoiceRows ?? [])
    setJobSheets(jobSheetRows ?? [])
    setQuotations(quotationRows ?? [])
    setHistoryLoading(false)
  }

  useEffect(() => {
    if (!id) return
    void loadCustomer(id)
    void loadHistory(id)
  }, [id])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!id) return

    setSaving(true)
    setSaveError(null)
    setSaved(false)

    const { error } = await supabase
      .from('customers')
      .update({
        name: form.name.trim(),
        phone: form.phone.trim(),
        address: form.address.trim() || null,
        gst_number: form.gst_number.trim() || null,
        notes: form.notes.trim() || null,
      })
      .eq('id', id)

    setSaving(false)

    if (error) {
      setSaveError(error.message)
      return
    }

    setSaved(true)
    void loadCustomer(id)
  }

  async function handleDelete() {
    if (!id || !customer) return
    if (!window.confirm(`Delete ${customer.name}? This cannot be undone.`)) return

    setDeleting(true)
    setDeleteError(null)

    const { error } = await supabase.from('customers').delete().eq('id', id)

    if (!error) {
      navigate('/customers')
      return
    }

    if (error.code === '23503') {
      const [
        { count: invoiceCount },
        { count: jobSheetCount },
        { count: quotationCount },
        { count: creditNoteCount },
      ] = await Promise.all([
        supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('customer_id', id),
        supabase.from('job_sheets').select('id', { count: 'exact', head: true }).eq('customer_id', id),
        supabase.from('quotations').select('id', { count: 'exact', head: true }).eq('customer_id', id),
        supabase.from('credit_notes').select('id', { count: 'exact', head: true }).eq('customer_id', id),
      ])

      const parts: string[] = []
      if (invoiceCount) parts.push(pluralize(invoiceCount, 'invoice'))
      if (jobSheetCount) parts.push(pluralize(jobSheetCount, 'job sheet'))
      if (quotationCount) parts.push(pluralize(quotationCount, 'quotation'))
      if (creditNoteCount) parts.push(pluralize(creditNoteCount, 'credit note'))

      setDeleteError(
        parts.length > 0
          ? `Can't delete — this customer has ${parts.join(', ')} on record.`
          : "Can't delete — this customer has related records on file.",
      )
    } else {
      setDeleteError(error.message)
    }

    setDeleting(false)
  }

  if (loading) {
    return <p className="px-6 py-10 text-center text-sm text-slate-400">Loading customer…</p>
  }

  if (error && !customer) {
    return <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
  }

  if (!customer) return null

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/customers" className="text-sm text-slate-400 hover:text-slate-600">
            ← All Customers
          </Link>
          <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight text-slate-900">
            {customer.name}
          </h1>
          <p className="mt-1 text-sm text-slate-400">{customer.phone}</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => void handleDelete()}
            disabled={deleting}
            className="rounded-xl px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete Customer'}
          </button>
        )}
      </div>

      {deleteError && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{deleteError}</p>
      )}

      <section className="mb-6 rounded-2xl bg-white p-5 card-shadow">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Customer Details</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value })
                  setSaved(false)
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Phone</label>
              <input
                type="tel"
                required
                value={form.phone}
                onChange={(e) => {
                  setForm({ ...form, phone: e.target.value })
                  setSaved(false)
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Address</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => {
                setForm({ ...form, address: e.target.value })
                setSaved(false)
              }}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">GST Number</label>
            <input
              type="text"
              value={form.gst_number}
              onChange={(e) => {
                setForm({ ...form, gst_number: e.target.value })
                setSaved(false)
              }}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Notes</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => {
                setForm({ ...form, notes: e.target.value })
                setSaved(false)
              }}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </div>

          {saveError && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{saveError}</p>
          )}
          {saved && !saveError && (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-600">Saved.</p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </section>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <section className="rounded-2xl bg-white p-5 card-shadow">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Invoices</h2>
          {historyLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-slate-400">No invoices yet.</p>
          ) : (
            <div className="space-y-1">
              {invoices.slice(0, HISTORY_LIMIT).map((invoice) => (
                <Link
                  key={invoice.id}
                  to={`/invoices/${invoice.id}`}
                  className="-mx-3 block rounded-xl px-3 py-2 transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900">{invoice.invoice_number}</span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        paymentStatusStyles[invoice.payment_status] ?? 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {formatLabel(invoice.payment_status)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-xs text-slate-400">
                    <span>{formatDate(invoice.created_at)}</span>
                    <span>{formatCurrencyExact(invoice.final_price)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {invoices.length > HISTORY_LIMIT && (
            <Link
              to={`/invoices?customer=${id}`}
              className="mt-2 inline-block text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              View all invoices →
            </Link>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 card-shadow">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Job Sheets</h2>
          {historyLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : jobSheets.length === 0 ? (
            <p className="text-sm text-slate-400">No job sheets yet.</p>
          ) : (
            <div className="space-y-1">
              {jobSheets.slice(0, HISTORY_LIMIT).map((js) => (
                <Link
                  key={js.id}
                  to={`/job-sheets/${js.id}`}
                  className="-mx-3 block rounded-xl px-3 py-2 transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900">{js.job_number}</span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        jobSheetStatusStyles[js.status] ?? 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {formatLabel(js.status)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {[js.device_brand, js.device_name].filter(Boolean).join(' ') || '—'}
                  </p>
                </Link>
              ))}
            </div>
          )}
          {jobSheets.length > HISTORY_LIMIT && (
            <Link
              to={`/job-sheets?customer=${id}`}
              className="mt-2 inline-block text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              View all job sheets →
            </Link>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 card-shadow">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Quotations</h2>
          {historyLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : quotations.length === 0 ? (
            <p className="text-sm text-slate-400">No quotations yet.</p>
          ) : (
            <div className="space-y-1">
              {quotations.slice(0, HISTORY_LIMIT).map((quotation) => (
                <Link
                  key={quotation.id}
                  to={`/quotations/${quotation.id}`}
                  className="-mx-3 block rounded-xl px-3 py-2 transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {quotation.quotation_number}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        quotationStatusStyles[quotation.status] ?? 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {formatLabel(quotation.status)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">{formatDate(quotation.created_at)}</p>
                </Link>
              ))}
            </div>
          )}
          {quotations.length > HISTORY_LIMIT && (
            <Link
              to={`/quotations?customer=${id}`}
              className="mt-2 inline-block text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              View all quotations →
            </Link>
          )}
        </section>
      </div>
    </div>
  )
}
