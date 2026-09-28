import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatCurrencyExact, formatDate } from '../../lib/format'

interface InvoiceSnapshot {
  invoice?: { final_price?: number; invoice_date?: string }
}

interface AmendmentRow {
  id: string
  amended_at: string
  amended_by: string
  reason: string
  before_snapshot: InvoiceSnapshot
  after_snapshot: InvoiceSnapshot
}

interface MemberLite {
  user_id: string
  name: string | null
  email: string
}

interface AmendmentHistorySectionProps {
  invoiceId: string
}

export default function AmendmentHistorySection({ invoiceId }: AmendmentHistorySectionProps) {
  const [amendments, setAmendments] = useState<AmendmentRow[]>([])
  const [members, setMembers] = useState<Record<string, MemberLite>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError(null)

      const { data, error } = await supabase
        .from('invoice_amendments')
        .select('id, amended_at, amended_by, reason, before_snapshot, after_snapshot')
        .eq('invoice_id', invoiceId)
        .order('amended_at', { ascending: false })

      if (!active) return

      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }

      const rows = (data ?? []) as unknown as AmendmentRow[]
      setAmendments(rows)

      const userIds = [...new Set(rows.map((r) => r.amended_by))]
      if (userIds.length > 0) {
        const { data: memberData } = await supabase
          .from('tenant_members')
          .select('user_id, name, email')
          .in('user_id', userIds)

        if (active) {
          const map: Record<string, MemberLite> = {}
          for (const m of (memberData ?? []) as MemberLite[]) map[m.user_id] = m
          setMembers(map)
        }
      }

      setLoading(false)
    }

    void load()
    return () => {
      active = false
    }
  }, [invoiceId])

  if (loading) {
    return <p className="text-sm text-slate-400">Loading amendment history…</p>
  }

  if (error) {
    return <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
  }

  return (
    <div className="space-y-2">
      {amendments.map((a) => {
        const admin = members[a.amended_by]
        const beforeTotal = a.before_snapshot?.invoice?.final_price
        const afterTotal = a.after_snapshot?.invoice?.final_price
        const beforeDate = a.before_snapshot?.invoice?.invoice_date
        const afterDate = a.after_snapshot?.invoice?.invoice_date
        const dateChanged = beforeDate != null && afterDate != null && beforeDate !== afterDate

        return (
          <div key={a.id} className="rounded-xl border border-slate-100 px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-900">
                {admin?.name || admin?.email || 'Unknown admin'}
              </span>
              <span className="text-slate-400">{formatDate(a.amended_at)}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{a.reason}</p>
            {dateChanged ? (
              <p className="mt-1 text-xs text-slate-400">
                Date: {formatDate(beforeDate)} → {formatDate(afterDate)}
              </p>
            ) : (
              beforeTotal != null &&
              afterTotal != null && (
                <p className="mt-1 text-xs text-slate-400">
                  Total: {formatCurrencyExact(beforeTotal)} → {formatCurrencyExact(afterTotal)}
                </p>
              )
            )}
          </div>
        )
      })}
    </div>
  )
}
