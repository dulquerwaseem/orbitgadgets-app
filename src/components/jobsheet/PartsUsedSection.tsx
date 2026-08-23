import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface PartUsedRow {
  id: string
  spare_part_id: string | null
  part_name: string
  quantity: number
}

interface SparePartOption {
  id: string
  name: string
  part_number: string | null
  quantity: number
}

type EntryMode = 'search' | 'manual'

interface PartsUsedSectionProps {
  jobSheetId: string
}

export default function PartsUsedSection({ jobSheetId }: PartsUsedSectionProps) {
  const [parts, setParts] = useState<PartUsedRow[]>([])
  const [spareParts, setSpareParts] = useState<SparePartOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [mode, setMode] = useState<EntryMode>('search')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<SparePartOption | null>(null)
  const [manualName, setManualName] = useState('')
  const [quantity, setQuantity] = useState('1')

  async function loadData() {
    setLoading(true)
    const [{ data: rows, error: rowsError }, { data: spares }] = await Promise.all([
      supabase
        .from('job_sheet_parts')
        .select('id, spare_part_id, part_name, quantity')
        .eq('job_sheet_id', jobSheetId)
        .order('created_at', { ascending: true }),
      supabase
        .from('spare_parts')
        .select('id, name, part_number, quantity')
        .order('created_at', { ascending: false })
        .limit(500),
    ])

    if (rowsError) setError(rowsError.message)
    setParts(rows ?? [])
    setSpareParts(spares ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [jobSheetId])

  const filteredSpareParts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return spareParts.slice(0, 8)
    return spareParts
      .filter((p) => p.name.toLowerCase().includes(q) || (p.part_number ?? '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [spareParts, search])

  function resetForm() {
    setMode('search')
    setSearch('')
    setSelected(null)
    setManualName('')
    setQuantity('1')
  }

  const canAdd =
    mode === 'search'
      ? selected !== null && Number(quantity) > 0
      : manualName.trim() !== '' && Number(quantity) > 0

  async function handleAdd() {
    if (!canAdd) return
    setSaving(true)
    setError(null)

    const { error } = await supabase.from('job_sheet_parts').insert({
      job_sheet_id: jobSheetId,
      spare_part_id: mode === 'search' ? selected!.id : null,
      part_name: mode === 'search' ? selected!.name : manualName.trim(),
      quantity: Number(quantity),
    })

    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }

    resetForm()
    void loadData()
  }

  async function handleRemove(id: string) {
    const { error } = await supabase.from('job_sheet_parts').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setParts((prev) => prev.filter((p) => p.id !== id))
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Loading parts…</p>
      ) : parts.length > 0 ? (
        <div className="mb-4 overflow-hidden rounded-xl border border-slate-100">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-4 py-2">Part</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {parts.map((part) => (
                <tr key={part.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-slate-900">{part.part_name}</td>
                  <td className="px-4 py-2.5 text-slate-500">{part.quantity}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => void handleRemove(part.id)}
                      className="text-xs font-medium text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mb-4 text-sm text-slate-400">No parts logged yet.</p>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              setMode('search')
              setManualName('')
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              mode === 'search' ? 'bg-slate-200 text-slate-900' : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            Search Existing
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('manual')
              setSelected(null)
              setSearch('')
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              mode === 'manual' ? 'bg-slate-200 text-slate-900' : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            Enter Manually
          </button>
        </div>

        {mode === 'search' &&
          (selected ? (
            <div className="mb-3 flex items-center justify-between rounded-lg bg-white px-3 py-2">
              <div>
                <p className="text-sm font-medium text-slate-900">{selected.name}</p>
                <p className="text-xs text-slate-400">In stock: {selected.quantity}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
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
                      onClick={() => setSelected(p)}
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

        {mode === 'manual' && (
          <div className="mb-3">
            <input
              type="text"
              placeholder="Part name"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </div>
        )}

        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
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
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={!canAdd || saving}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Adding…' : 'Add Part'}
          </button>
        </div>
      </div>
    </div>
  )
}
