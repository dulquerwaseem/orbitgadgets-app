import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate, formatLabel } from '../lib/format'
import type { Customer } from '../components/CustomerPicker'
import PartsUsedSection from '../components/jobsheet/PartsUsedSection'
import PrintHeader from '../components/print/PrintHeader'
import PrintFooter from '../components/print/PrintFooter'

type JobStatus = 'intake' | 'in_progress' | 'ready' | 'delivered'

interface JobSheetData {
  id: string
  job_number: string
  status: JobStatus
  device_name: string | null
  device_brand: string | null
  device_imei: string | null
  device_color: string | null
  reported_problem: string | null
  physical_condition: string | null
  accessories_received: string | null
  technician_notes: string | null
  estimated_ready_date: string | null
  delivered_at: string | null
  invoice_id: string | null
  created_at: string
  customers: Customer | null
  invoices: { id: string; invoice_number: string } | null
}

const statusFlow: JobStatus[] = ['intake', 'in_progress', 'ready', 'delivered']

const statusStyles: Record<string, string> = {
  intake: 'bg-slate-100 text-slate-500',
  in_progress: 'bg-sky-50 text-sky-600',
  ready: 'bg-amber-50 text-amber-700',
  delivered: 'bg-emerald-50 text-emerald-600',
}

export default function JobSheetDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [jobSheet, setJobSheet] = useState<JobSheetData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [technicianNotes, setTechnicianNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [markingDelivered, setMarkingDelivered] = useState(false)

  async function loadJobSheet(jobSheetId: string) {
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('job_sheets')
      .select(
        'id, job_number, status, device_name, device_brand, device_imei, device_color, ' +
          'reported_problem, physical_condition, accessories_received, technician_notes, ' +
          'estimated_ready_date, delivered_at, invoice_id, created_at, ' +
          'customers(id, name, phone, address, gst_number), ' +
          'invoices!job_sheets_invoice_id_fkey(id, invoice_number)',
      )
      .eq('id', jobSheetId)
      .single()

    if (error || !data) {
      setError(error?.message ?? 'Job sheet not found')
      setLoading(false)
      return
    }

    const row = data as unknown as JobSheetData
    setJobSheet(row)
    setTechnicianNotes(row.technician_notes ?? '')
    setLoading(false)
  }

  useEffect(() => {
    if (id) void loadJobSheet(id)
  }, [id])

  async function handleSaveNotes() {
    if (!jobSheet) return
    setSavingNotes(true)
    setError(null)

    const { error } = await supabase
      .from('job_sheets')
      .update({ technician_notes: technicianNotes.trim() || null })
      .eq('id', jobSheet.id)

    setSavingNotes(false)

    if (error) {
      setError(error.message)
      return
    }

    setJobSheet({ ...jobSheet, technician_notes: technicianNotes.trim() || null })
  }

  async function handleStatusChange(next: JobStatus) {
    if (!jobSheet || next === jobSheet.status) return
    setUpdatingStatus(true)
    setError(null)

    const { error } = await supabase
      .from('job_sheets')
      .update({ status: next })
      .eq('id', jobSheet.id)

    setUpdatingStatus(false)

    if (error) {
      setError(error.message)
      return
    }

    setJobSheet({ ...jobSheet, status: next })
  }

  async function handleMarkDeliveredAndBill() {
    if (!jobSheet) return

    if (jobSheet.status !== 'delivered') {
      if (
        !window.confirm('Mark this job sheet as delivered and start a new invoice for it?')
      )
        return

      setMarkingDelivered(true)
      setError(null)

      const { error } = await supabase
        .from('job_sheets')
        .update({ status: 'delivered', delivered_at: new Date().toISOString() })
        .eq('id', jobSheet.id)

      setMarkingDelivered(false)

      if (error) {
        setError(error.message)
        return
      }
    }

    navigate('/invoices/new', {
      state: {
        jobSheetId: jobSheet.id,
        jobSheetNumber: jobSheet.job_number,
        deviceName: jobSheet.device_name,
        customer: jobSheet.customers ?? undefined,
      },
    })
  }

  if (loading) {
    return <p className="px-6 py-10 text-center text-sm text-slate-400">Loading job sheet…</p>
  }

  if (error && !jobSheet) {
    return <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
  }

  if (!jobSheet) return null

  return (
    <div>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/job-sheets" className="text-sm text-slate-400 hover:text-slate-600">
            ← All Job Sheets
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">
              {jobSheet.job_number}
            </h1>
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                statusStyles[jobSheet.status] ?? 'bg-slate-100 text-slate-500'
              }`}
            >
              {formatLabel(jobSheet.status)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => window.print()}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100"
          >
            Print
          </button>
          {jobSheet.invoices ? (
            <Link
              to={`/invoices/${jobSheet.invoices.id}`}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100"
            >
              View Invoice {jobSheet.invoices.invoice_number}
            </Link>
          ) : (
            <button
              onClick={() => void handleMarkDeliveredAndBill()}
              disabled={markingDelivered}
              className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
            >
              {markingDelivered
                ? 'Updating…'
                : jobSheet.status === 'delivered'
                  ? 'Create Invoice'
                  : 'Mark Delivered & Bill'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="no-print mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}

      <div className="mb-6 rounded-2xl bg-white p-8 card-shadow print:shadow-none">
        <PrintHeader label="Job Sheet" />

        <div className="mb-8 grid grid-cols-2 gap-6">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              Customer
            </p>
            <p className="text-sm font-medium text-slate-900">{jobSheet.customers?.name ?? '—'}</p>
            <p className="text-sm text-slate-500">{jobSheet.customers?.phone ?? '—'}</p>
            {jobSheet.customers?.address && (
              <p className="text-sm text-slate-500">{jobSheet.customers.address}</p>
            )}
          </div>
          <div className="text-right text-sm text-slate-500">
            <p>
              Job No: <span className="font-semibold text-slate-900">{jobSheet.job_number}</span>
            </p>
            <p className="mt-1">Date: {formatDate(jobSheet.created_at)}</p>
            <p className="mt-3 mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              Device
            </p>
            <p className="text-slate-900">
              {[jobSheet.device_brand, jobSheet.device_name].filter(Boolean).join(' ') || '—'}
            </p>
            {jobSheet.device_imei && <p>IMEI: {jobSheet.device_imei}</p>}
            {jobSheet.device_color && <p>Color: {jobSheet.device_color}</p>}
          </div>
        </div>

        <div className="mb-8 space-y-4 text-sm">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              Reported Problem
            </p>
            <p className="whitespace-pre-wrap text-slate-900">{jobSheet.reported_problem ?? '—'}</p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              Physical Condition
            </p>
            <p className="whitespace-pre-wrap text-slate-900">
              {jobSheet.physical_condition ?? '—'}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              Accessories Received
            </p>
            <p className="whitespace-pre-wrap text-slate-900">
              {jobSheet.accessories_received ?? '—'}
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
              Estimated Ready Date
            </p>
            <p className="text-slate-900">{formatDate(jobSheet.estimated_ready_date)}</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-300 bg-slate-50 p-5 text-sm text-slate-700">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Customer Acknowledgement
          </p>
          <p>Device received as described above.</p>
          <div className="mt-10 flex items-end gap-10">
            <div className="flex-1 border-t border-slate-400 pt-1 text-xs text-slate-500">
              Customer Signature
            </div>
            <div className="w-48 border-t border-slate-400 pt-1 text-xs text-slate-500">Date</div>
          </div>
        </div>

        <PrintFooter note="Please retain this slip for your records." />
      </div>

      <div className="no-print grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Status</h2>
            <div className="flex flex-wrap gap-1.5">
              {statusFlow.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => void handleStatusChange(status)}
                  disabled={updatingStatus}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                    jobSheet.status === status
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {formatLabel(status)}
                </button>
              ))}
            </div>
            {jobSheet.delivered_at && (
              <p className="mt-2 text-xs text-slate-400">
                Delivered on {formatDate(jobSheet.delivered_at)}
              </p>
            )}
          </section>

          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Device</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Brand</p>
                <p className="mt-0.5 text-slate-900">{jobSheet.device_brand ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Device</p>
                <p className="mt-0.5 text-slate-900">{jobSheet.device_name ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  IMEI / Serial
                </p>
                <p className="mt-0.5 text-slate-900">{jobSheet.device_imei ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Color</p>
                <p className="mt-0.5 text-slate-900">{jobSheet.device_color ?? '—'}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Intake Details</h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Reported Problem
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-slate-900">
                  {jobSheet.reported_problem ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Physical Condition
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-slate-900">
                  {jobSheet.physical_condition ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Accessories Received
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-slate-900">
                  {jobSheet.accessories_received ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Estimated Ready Date
                </p>
                <p className="mt-0.5 text-slate-900">{formatDate(jobSheet.estimated_ready_date)}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Technician Notes</h2>
            <textarea
              rows={4}
              value={technicianNotes}
              onChange={(e) => setTechnicianNotes(e.target.value)}
              placeholder="Diagnosis, work performed, follow-ups…"
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 focus:bg-white"
            />
            <button
              type="button"
              onClick={() => void handleSaveNotes()}
              disabled={savingNotes || technicianNotes === (jobSheet.technician_notes ?? '')}
              className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50"
            >
              {savingNotes ? 'Saving…' : 'Save Notes'}
            </button>
          </section>

          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Parts Used</h2>
            <PartsUsedSection jobSheetId={jobSheet.id} />
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Customer</h2>
            {jobSheet.customers ? (
              <div className="text-sm">
                <p className="font-medium text-slate-900">{jobSheet.customers.name}</p>
                <p className="mt-0.5 text-slate-500">{jobSheet.customers.phone}</p>
                {jobSheet.customers.address && (
                  <p className="mt-0.5 text-slate-400">{jobSheet.customers.address}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No customer on file.</p>
            )}
          </section>

          <section className="rounded-2xl bg-white p-5 card-shadow">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Timeline</h2>
            <p className="text-sm text-slate-500">Intake: {formatDate(jobSheet.created_at)}</p>
            {jobSheet.delivered_at && (
              <p className="mt-1 text-sm text-slate-500">
                Delivered: {formatDate(jobSheet.delivered_at)}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
