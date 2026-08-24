import { shopInfo } from '../../lib/shopInfo'

interface PrintHeaderProps {
  label: string
}

export default function PrintHeader({ label }: PrintHeaderProps) {
  return (
    <div className="mb-6 border-b-2 border-slate-800 pb-4">
      <div className="flex items-start justify-between gap-4">
        <img src={shopInfo.logo} alt={shopInfo.name} className="h-20 w-20 object-contain" />
        <p className="text-sm font-medium text-slate-600">{label}</p>
      </div>
      <div className="mt-2 text-xs leading-relaxed text-slate-500">
        <p>{shopInfo.address}</p>
        <p>
          Phone: {shopInfo.phones.join(' · ')} · Email: {shopInfo.email}
        </p>
        <p className="font-medium text-slate-600">GSTIN: {shopInfo.gstin}</p>
      </div>
    </div>
  )
}
