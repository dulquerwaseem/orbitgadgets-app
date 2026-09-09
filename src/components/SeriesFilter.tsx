export type SeriesFilterValue = 'all' | 'gst' | 'non_gst'

const options: { value: SeriesFilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'gst', label: 'GST' },
  { value: 'non_gst', label: 'Non-GST' },
]

interface SeriesFilterProps {
  value: SeriesFilterValue
  onChange: (value: SeriesFilterValue) => void
}

export default function SeriesFilter({ value, onChange }: SeriesFilterProps) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            value === opt.value
              ? 'bg-slate-900 text-white'
              : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
