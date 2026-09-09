import { shopInfo } from '../../lib/shopInfo'

interface PrintHeaderProps {
  label: string
}

export default function PrintHeader({ label }: PrintHeaderProps) {
  return (
    <div className="mb-6 border-b-2 border-slate-800 pb-4">
      <div className="flex items-start justify-between gap-4">
        <img src={shopInfo.logo} alt={shopInfo.name} className="h-32 w-32 object-contain" />
        <p className="text-sm font-medium text-slate-600">{label}</p>
      </div>
      <div className="mt-2 max-w-sm text-xs leading-relaxed text-slate-500">
        <p>{shopInfo.address}</p>
        <p className="mt-1">
          Phone: {shopInfo.phones.join(', ')} · Email: {shopInfo.email} ·{' '}
          <span className="font-medium text-slate-600">GSTIN: {shopInfo.gstin}</span>
        </p>
      </div>
    </div>
  )
}
