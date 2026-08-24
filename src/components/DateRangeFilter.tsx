import { useEffect, useRef, useState } from 'react'
import { Calendar, ChevronDown } from 'lucide-react'

export type DateRangePreset = 'all' | 'today' | 'yesterday' | 'last7' | 'custom'

export interface ResolvedDateRange {
  start: Date | null
  end: Date | null
}

const presetOptions: { value: DateRangePreset; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 Days' },
  { value: 'custom', label: 'Custom' },
]

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function endOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(23, 59, 59, 999)
  return copy
}

function resolveRange(preset: DateRangePreset, customFrom: string, customTo: string): ResolvedDateRange {
  const now = new Date()

  switch (preset) {
    case 'today':
      return { start: startOfDay(now), end: endOfDay(now) }
    case 'yesterday': {
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      return { start: startOfDay(yesterday), end: endOfDay(yesterday) }
    }
    case 'last7': {
      const from = new Date(now)
      from.setDate(from.getDate() - 6)
      return { start: startOfDay(from), end: endOfDay(now) }
    }
    case 'custom':
      return {
        start: customFrom ? startOfDay(new Date(`${customFrom}T00:00:00`)) : null,
        end: customTo ? endOfDay(new Date(`${customTo}T00:00:00`)) : null,
      }
    case 'all':
    default:
      return { start: null, end: null }
  }
}

// Compares a stored timestamp/date string against a resolved range, in the
// browser's local timezone (matches how the presets themselves are resolved).
export function isWithinDateRange(value: string | null | undefined, range: ResolvedDateRange): boolean {
  if (!range.start && !range.end) return true
  if (!value) return false
  const parsed = new Date(value)
  if (range.start && parsed < range.start) return false
  if (range.end && parsed > range.end) return false
  return true
}

function shortLabel(customFrom: string, customTo: string): string {
  const fmt = (value: string) =>
    new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  if (customFrom && customTo) return `${fmt(customFrom)} – ${fmt(customTo)}`
  if (customFrom) return `From ${fmt(customFrom)}`
  if (customTo) return `Until ${fmt(customTo)}`
  return 'Custom'
}

interface DateRangeFilterProps {
  onChange: (range: ResolvedDateRange) => void
}

export default function DateRangeFilter({ onChange }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<DateRangePreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function selectPreset(next: DateRangePreset) {
    setPreset(next)
    if (next === 'custom') return
    setOpen(false)
    onChange(resolveRange(next, customFrom, customTo))
  }

  function applyCustom() {
    setOpen(false)
    onChange(resolveRange('custom', customFrom, customTo))
  }

  const triggerLabel =
    preset === 'custom' && (customFrom || customTo)
      ? shortLabel(customFrom, customTo)
      : (presetOptions.find((opt) => opt.value === preset)?.label ?? 'All Time')

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
      >
        <Calendar className="h-4 w-4 text-slate-400" strokeWidth={2} />
        {triggerLabel}
        <ChevronDown className="h-4 w-4 text-slate-400" strokeWidth={2} />
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_32px_-12px_rgba(15,23,42,0.2)]">
          <div className="space-y-0.5">
            {presetOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => selectPreset(opt.value)}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                  preset === opt.value
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {preset === 'custom' && (
            <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">From</label>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">To</label>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-slate-400"
                />
              </div>
              <button
                type="button"
                onClick={applyCustom}
                className="w-full rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
