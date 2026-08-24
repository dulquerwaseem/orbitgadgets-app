interface PrintFooterProps {
  note: string
}

export default function PrintFooter({ note }: PrintFooterProps) {
  return (
    <div className="mt-10 border-t border-slate-300 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <p className="text-xs text-slate-400">{note}</p>
        <div className="w-52 text-center">
          <div className="h-12" />
          <p className="border-t border-slate-400 pt-1 text-xs text-slate-500">Authorized Signatory</p>
        </div>
      </div>
    </div>
  )
}
