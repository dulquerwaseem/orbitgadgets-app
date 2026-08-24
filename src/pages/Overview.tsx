import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Wrench, ReceiptIndianRupee, PackageSearch, FileClock, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrencyExact, formatDate, formatLabel } from '../lib/format'

interface Stats {
  openJobSheets: number
  unpaidInvoiceCount: number
  unpaidInvoiceTotal: number
  lowStockCount: number
  pendingQuotations: number
}

const emptyStats: Stats = {
  openJobSheets: 0,
  unpaidInvoiceCount: 0,
  unpaidInvoiceTotal: 0,
  lowStockCount: 0,
  pendingQuotations: 0,
}

interface RecentInvoice {
  id: string
  invoice_number: string
  final_price: number
  payment_status: string
  customers: { name: string } | null
}

interface ActiveJobSheet {
  id: string
  job_number: string
  status: string
  device_name: string | null
  device_brand: string | null
  customers: { name: string } | null
}

const paymentStatusStyles: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-600',
  partial: 'bg-amber-50 text-amber-600',
  unpaid: 'bg-red-50 text-red-500',
}

const jobStatusStyles: Record<string, string> = {
  intake: 'bg-slate-100 text-slate-500',
  in_progress: 'bg-sky-50 text-sky-600',
  ready: 'bg-amber-50 text-amber-700',
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function Overview() {
  const { membership } = useAuth()
  const [stats, setStats] = useState<Stats>(emptyStats)
  const [recentInvoices, setRecentInvoices] = useState<RecentInvoice[]>([])
  const [activeJobSheets, setActiveJobSheets] = useState<ActiveJobSheet[]>([])
  const [loading, setLoading] = useState(true)

  async function loadData() {
    setLoading(true)

    const [
      { count: openJobSheets },
      { data: unpaidInvoices },
      { data: spareParts },
      { count: pendingQuotations },
      { data: recentInvoicesData },
      { data: activeJobSheetsData },
    ] = await Promise.all([
      supabase.from('job_sheets').select('id', { count: 'exact', head: true }).neq('status', 'delivered'),
      supabase.from('invoices').select('final_price').eq('payment_status', 'unpaid').eq('superseded', false),
      supabase.from('spare_parts').select('quantity, reorder_level'),
      supabase.from('quotations').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase
        .from('invoices')
        .select('id, invoice_number, final_price, payment_status, customers(name)')
        .eq('superseded', false)
        .order('created_at', { ascending: false })
        .limit(5),
      supabase
        .from('job_sheets')
        .select('id, job_number, status, device_name, device_brand, customers(name)')
        .neq('status', 'delivered')
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    const lowStockCount = (spareParts ?? []).filter(
      (p) => p.reorder_level !== null && p.quantity <= p.reorder_level,
    ).length

    setStats({
      openJobSheets: openJobSheets ?? 0,
      unpaidInvoiceCount: unpaidInvoices?.length ?? 0,
      unpaidInvoiceTotal: (unpaidInvoices ?? []).reduce((sum, i) => sum + i.final_price, 0),
      lowStockCount,
      pendingQuotations: pendingQuotations ?? 0,
    })
    setRecentInvoices((recentInvoicesData as unknown as RecentInvoice[]) ?? [])
    setActiveJobSheets((activeJobSheetsData as unknown as ActiveJobSheet[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  const headline = loading
    ? 'Loading today’s picture…'
    : stats.unpaidInvoiceCount > 0
      ? `${stats.unpaidInvoiceCount} invoice${stats.unpaidInvoiceCount === 1 ? '' : 's'} unpaid · ${formatCurrencyExact(stats.unpaidInvoiceTotal)} outstanding`
      : 'All invoices are settled'

  const statCards: {
    to: string
    icon: typeof Wrench
    value: number
    label: string
    attentionColor: string | null
  }[] = [
    {
      to: '/job-sheets',
      icon: Wrench,
      value: stats.openJobSheets,
      label: 'Open Job Sheets',
      attentionColor: null,
    },
    {
      to: '/invoices',
      icon: ReceiptIndianRupee,
      value: stats.unpaidInvoiceCount,
      label: 'Unpaid Invoices',
      attentionColor: stats.unpaidInvoiceCount > 0 ? 'text-red-500' : null,
    },
    {
      to: '/spare-parts',
      icon: PackageSearch,
      value: stats.lowStockCount,
      label: 'Low Stock Parts',
      attentionColor: stats.lowStockCount > 0 ? 'text-amber-600' : null,
    },
    {
      to: '/quotations',
      icon: FileClock,
      value: stats.pendingQuotations,
      label: 'Pending Quotations',
      attentionColor: null,
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-slate-400">{greeting()}</p>
        <h1 className="font-heading mt-1 text-2xl font-semibold tracking-tight text-slate-900">
          {headline}
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <Link
            key={card.label}
            to={card.to}
            className="card-shadow group rounded-2xl bg-white p-6 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:shadow-sm"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 transition-colors group-hover:bg-slate-200">
              <card.icon className="h-[18px] w-[18px] text-slate-500" strokeWidth={2} />
            </div>
            <p className={`text-4xl font-semibold tabular-nums ${card.attentionColor ?? 'text-slate-900'}`}>
              {loading ? '—' : card.value}
            </p>
            <p className="mt-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
              {card.label}
            </p>
          </Link>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-6 card-shadow">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/invoices/new"
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 active:opacity-100"
          >
            <Plus className="h-4 w-4" /> New Invoice
          </Link>
          <Link
            to="/job-sheets/new"
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100"
          >
            <Plus className="h-4 w-4" /> New Job Sheet
          </Link>
          <Link
            to="/quotations/new"
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100"
          >
            <Plus className="h-4 w-4" /> New Quotation
          </Link>
          {membership?.role === 'admin' && (
            <Link
              to="/vendor-purchases/new"
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100"
            >
              <Plus className="h-4 w-4" /> New Vendor Purchase
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl bg-white card-shadow">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Recent Invoices</h2>
            <Link to="/invoices" className="text-xs font-medium text-slate-400 hover:text-slate-700">
              View all
            </Link>
          </div>
          {loading ? (
            <p className="px-6 py-8 text-center text-sm text-slate-400">Loading…</p>
          ) : recentInvoices.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-400">No invoices yet.</p>
          ) : (
            <div>
              {recentInvoices.map((invoice) => (
                <Link
                  key={invoice.id}
                  to={`/invoices/${invoice.id}`}
                  className="flex items-center justify-between border-b border-slate-50 px-6 py-3 text-sm transition-colors last:border-0 hover:bg-slate-50 active:bg-slate-100"
                >
                  <div>
                    <p className="font-medium text-slate-900">{invoice.invoice_number}</p>
                    <p className="text-xs text-slate-400">{invoice.customers?.name ?? '—'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-slate-700">
                      {formatCurrencyExact(invoice.final_price)}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                        paymentStatusStyles[invoice.payment_status] ?? 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {formatLabel(invoice.payment_status)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl bg-white card-shadow">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <h2 className="text-sm font-semibold text-slate-900">Job Sheets In Progress</h2>
            <Link to="/job-sheets" className="text-xs font-medium text-slate-400 hover:text-slate-700">
              View all
            </Link>
          </div>
          {loading ? (
            <p className="px-6 py-8 text-center text-sm text-slate-400">Loading…</p>
          ) : activeJobSheets.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-400">No open job sheets.</p>
          ) : (
            <div>
              {activeJobSheets.map((js) => (
                <Link
                  key={js.id}
                  to={`/job-sheets/${js.id}`}
                  className="flex items-center justify-between border-b border-slate-50 px-6 py-3 text-sm transition-colors last:border-0 hover:bg-slate-50 active:bg-slate-100"
                >
                  <div>
                    <p className="font-medium text-slate-900">{js.job_number}</p>
                    <p className="text-xs text-slate-400">
                      {js.customers?.name ?? '—'}
                      {js.device_brand || js.device_name
                        ? ` · ${[js.device_brand, js.device_name].filter(Boolean).join(' ')}`
                        : ''}
                    </p>
                  </div>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                      jobStatusStyles[js.status] ?? 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {formatLabel(js.status)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-slate-400">Updated {formatDate(new Date().toISOString())}</p>
    </div>
  )
}
