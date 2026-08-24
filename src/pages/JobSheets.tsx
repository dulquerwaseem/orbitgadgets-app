import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate, formatLabel } from '../lib/format'

interface JobSheetRow {
  id: string
  job_number: string
  status: string
  device_name: string | null
  device_brand: string | null
  estimated_ready_date: string | null
  customers: { name: string } | null
}

type StatusFilter = 'all' | 'intake' | 'in_progress' | 'ready' | 'delivered'

const statusTabs: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'intake', label: 'Intake' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'ready', label: 'Ready' },
  { value: 'delivered', label: 'Delivered' },
]

const statusStyles: Record<string, string> = {
  intake: 'bg-slate-100 text-slate-500',
  in_progress: 'bg-sky-50 text-sky-600',
  ready: 'bg-amber-50 text-amber-700',
  delivered: 'bg-emerald-50 text-emerald-600',
}

export default function JobSheets() {
  const navigate = useNavigate()
  const [jobSheets, setJobSheets] = useState<JobSheetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  async function loadJobSheets() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('job_sheets')
      .select('id, job_number, status, device_name, device_brand, estimated_ready_date, customers(name)')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      setJobSheets((data as unknown as JobSheetRow[]) ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadJobSheets()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return jobSheets.filter((js) => {
      if (statusFilter !== 'all' && js.status !== statusFilter) return false
      if (!q) return true
      return (
        js.job_number.toLowerCase().includes(q) ||
        (js.customers?.name ?? '').toLowerCase().includes(q) ||
        (js.device_name ?? '').toLowerCase().includes(q) ||
        (js.device_brand ?? '').toLowerCase().includes(q)
      )
    })
  }, [jobSheets, statusFilter, search])

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Job Sheets</h1>
          <p className="mt-1 text-sm text-slate-400">
            {filtered.length} of {jobSheets.length} job sheets
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search by job number, customer, or device"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-72 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400"
          />
          <Link
            to="/job-sheets/new"
            className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2 text-sm font-medium transition-opacity"
          >
            New Job Sheet
          </Link>
        </div>
      </div>

      <div className="mb-4 flex gap-1.5">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-500 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}

      <div className="overflow-hidden rounded-2xl bg-white card-shadow">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">Loading job sheets…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {jobSheets.length === 0
              ? 'No job sheets yet. Create your first one.'
              : 'No job sheets match your filters.'}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-6 py-3">Job Number</th>
                <th className="px-6 py-3">Customer</th>
                <th className="px-6 py-3">Device</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Est. Ready</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((js) => (
                <tr
                  key={js.id}
                  onClick={() => navigate(`/job-sheets/${js.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/job-sheets/${js.id}`)
                  }}
                  className="cursor-pointer border-b border-slate-50 outline-none last:border-0 hover:bg-slate-50 focus-visible:bg-slate-50 active:bg-slate-100"
                >
                  <td className="px-6 py-3.5 font-medium text-slate-900">{js.job_number}</td>
                  <td className="px-6 py-3.5 text-slate-500">{js.customers?.name ?? '—'}</td>
                  <td className="px-6 py-3.5 text-slate-500">
                    {[js.device_brand, js.device_name].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="px-6 py-3.5">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        statusStyles[js.status] ?? 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {formatLabel(js.status)}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-slate-500">{formatDate(js.estimated_ready_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
