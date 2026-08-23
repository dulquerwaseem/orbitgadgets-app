import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

export interface JobSheetOption {
  id: string
  job_number: string
  device_name: string | null
  customer_id: string | null
}

interface JobSheetPickerProps {
  value: JobSheetOption | null
  onChange: (jobSheet: JobSheetOption | null) => void
}

export default function JobSheetPicker({ value, onChange }: JobSheetPickerProps) {
  const [jobSheets, setJobSheets] = useState<JobSheetOption[]>([])
  const [search, setSearch] = useState('')

  async function loadJobSheets() {
    const { data } = await supabase
      .from('job_sheets')
      .select('id, job_number, device_name, customer_id')
      .order('created_at', { ascending: false })
      .limit(500)
    setJobSheets(data ?? [])
  }

  useEffect(() => {
    void loadJobSheets()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return jobSheets.slice(0, 8)
    return jobSheets
      .filter(
        (j) =>
          j.job_number.toLowerCase().includes(q) ||
          (j.device_name ?? '').toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [jobSheets, search])

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-slate-900">{value.job_number}</p>
          {value.device_name && <p className="text-xs text-slate-500">{value.device_name}</p>}
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-200"
        >
          Remove
        </button>
      </div>
    )
  }

  return (
    <div>
      <input
        type="text"
        placeholder="Search by job number or device (optional)"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
      />
      {search.trim() && filtered.length > 0 && (
        <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-slate-100">
          {filtered.map((j) => (
            <button
              key={j.id}
              type="button"
              onClick={() => onChange(j)}
              className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors hover:bg-slate-50"
            >
              <span className="font-medium text-slate-900">{j.job_number}</span>
              <span className="text-xs text-slate-400">{j.device_name ?? '—'}</span>
            </button>
          ))}
        </div>
      )}
      {search.trim() && filtered.length === 0 && (
        <p className="mt-2 text-xs text-slate-400">No matching job sheets.</p>
      )}
    </div>
  )
}
