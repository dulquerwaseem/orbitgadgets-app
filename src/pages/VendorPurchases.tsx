import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrencyExact, formatDate, formatLabel } from '../lib/format'
import DateRangeFilter, { isWithinDateRange } from '../components/DateRangeFilter'
import type { ResolvedDateRange } from '../components/DateRangeFilter'

interface VendorPurchaseRow {
  id: string
  purchase_number: string
  purchase_date: string
  payment_status: string
  grand_total: number
  vendors: { name: string } | null
}

const paymentStatusStyles: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-600',
  partial: 'bg-amber-50 text-amber-600',
  unpaid: 'bg-red-50 text-red-500',
}

export default function VendorPurchases() {
  const navigate = useNavigate()
  const { membership } = useAuth()
  const isAdmin = membership?.role === 'admin'

  const [purchases, setPurchases] = useState<VendorPurchaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<ResolvedDateRange>({ start: null, end: null })

  async function loadPurchases() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('vendor_purchases')
      .select('id, purchase_number, purchase_date, payment_status, grand_total, vendors(name)')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      setPurchases((data as unknown as VendorPurchaseRow[]) ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadPurchases()
  }, [])

  const filtered = useMemo(
    () => purchases.filter((purchase) => isWithinDateRange(purchase.purchase_date, dateRange)),
    [purchases, dateRange],
  )

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Vendor Purchases</h1>
          <p className="mt-1 text-sm text-slate-400">
            {filtered.length} of {purchases.length} purchases
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DateRangeFilter onChange={setDateRange} />
          {isAdmin && (
            <Link
              to="/vendor-purchases/new"
              className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2 text-sm font-medium transition-opacity"
            >
              New Purchase
            </Link>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}

      <div className="overflow-hidden rounded-2xl bg-white card-shadow">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">Loading purchases…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">
            {purchases.length === 0
              ? `No purchases yet.${isAdmin ? ' Create your first one.' : ''}`
              : 'No purchases match this date range.'}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-6 py-3">Purchase Number</th>
                <th className="px-6 py-3">Vendor</th>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Payment</th>
                <th className="px-6 py-3">Grand Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((purchase) => (
                <tr
                  key={purchase.id}
                  onClick={() => navigate(`/vendor-purchases/${purchase.id}`)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/vendor-purchases/${purchase.id}`)
                  }}
                  className="cursor-pointer border-b border-slate-50 outline-none last:border-0 hover:bg-slate-50 focus-visible:bg-slate-50 active:bg-slate-100"
                >
                  <td className="px-6 py-3.5 font-medium text-slate-900">{purchase.purchase_number}</td>
                  <td className="px-6 py-3.5 text-slate-500">{purchase.vendors?.name ?? '—'}</td>
                  <td className="px-6 py-3.5 text-slate-500">{formatDate(purchase.purchase_date)}</td>
                  <td className="px-6 py-3.5">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        paymentStatusStyles[purchase.payment_status] ?? 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {formatLabel(purchase.payment_status)}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 font-medium text-slate-700">
                    {formatCurrencyExact(purchase.grand_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
