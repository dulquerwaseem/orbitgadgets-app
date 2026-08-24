import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatCurrencyExact, formatDate, formatLabel } from '../lib/format'
import PrintHeader from '../components/print/PrintHeader'
import PrintFooter from '../components/print/PrintFooter'

interface QuotationDetailData {
  id: string
  quotation_number: string
  invoice_series: 'gst' | 'non_gst'
  discount: number
  subtotal: number
  cgst_amount: number
  sgst_amount: number
  total: number
  labor_charge: number
  labor_sac_code: string | null
  valid_until: string | null
  notes: string | null
  status: string
  converted_invoice_id: string | null
  created_at: string
  customers: { name: string; phone: string; address: string | null; gst_number: string | null } | null
  invoices: { id: string; invoice_number: string } | null
}

interface QuotationItemRow {
  id: string
  item_type: string
  item_name: string
  description: string | null
  hsn_code: string | null
  serial_imei: string | null
  ram: string | null
  storage: string | null
  quantity: number
  unit_price: number
  total_price: number
}

const statusStyles: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-500',
  converted: 'bg-emerald-50 text-emerald-600',
}

export default function QuotationDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [quotation, setQuotation] = useState<QuotationDetailData | null>(null)
  const [items, setItems] = useState<QuotationItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)

  async function loadQuotation(quotationId: string) {
    setLoading(true)
    setError(null)

    const [{ data: quotationData, error: quotationError }, { data: itemsData, error: itemsError }] =
      await Promise.all([
        supabase
          .from('quotations')
          .select('*, customers(name, phone, address, gst_number), invoices(id, invoice_number)')
          .eq('id', quotationId)
          .single(),
        supabase
          .from('quotation_items')
          .select(
            'id, item_type, item_name, description, hsn_code, serial_imei, ram, storage, quantity, unit_price, total_price',
          )
          .eq('quotation_id', quotationId)
          .order('created_at', { ascending: true }),
      ])

    if (quotationError || !quotationData) {
      setError(quotationError?.message ?? 'Quotation not found')
      setLoading(false)
      return
    }
    if (itemsError) {
      setError(itemsError.message)
      setLoading(false)
      return
    }

    setQuotation(quotationData as unknown as QuotationDetailData)
    setItems(itemsData ?? [])
    setLoading(false)
  }

  useEffect(() => {
    if (id) void loadQuotation(id)
  }, [id])

  async function handleConvert() {
    if (!id) return
    if (
      !window.confirm(
        'Convert this quotation to a real invoice? This will deduct stock and mark products sold.',
      )
    )
      return

    setConverting(true)
    setError(null)
    const { data, error } = await supabase.rpc('convert_quotation_to_invoice', {
      p_quotation_id: id,
    })
    setConverting(false)

    if (error) {
      setError(error.message)
      return
    }

    navigate(`/invoices/${data.id}`)
  }

  if (loading) {
    return <p className="px-6 py-10 text-center text-sm text-slate-400">Loading quotation…</p>
  }

  if (error && !quotation) {
    return <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
  }

  if (!quotation) return null

  return (
    <div>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to="/quotations" className="text-sm text-slate-400 hover:text-slate-600">
            ← All Quotations
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">
              {quotation.quotation_number}
            </h1>
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                statusStyles[quotation.status] ?? 'bg-slate-100 text-slate-500'
              }`}
            >
              {formatLabel(quotation.status)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {quotation.status !== 'converted' && (
            <button
              onClick={() => void handleConvert()}
              disabled={converting}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50"
            >
              {converting ? 'Converting…' : 'Convert to Invoice'}
            </button>
          )}
          <button
            onClick={() => window.print()}
            className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2 text-sm font-medium transition-opacity"
          >
            Print / Download
          </button>
        </div>
      </div>

      {error && (
        <p className="no-print mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}

      {quotation.status === 'converted' && quotation.invoices && (
        <div className="no-print mb-4 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
          Converted to invoice{' '}
          <Link to={`/invoices/${quotation.invoices.id}`} className="font-medium underline">
            {quotation.invoices.invoice_number}
          </Link>
          .
        </div>
      )}

      <div className="rounded-2xl bg-white p-8 card-shadow print:shadow-none">
        <PrintHeader label="Quotation" />

        <div className="mb-8 grid grid-cols-2 gap-6">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">For</p>
            <p className="text-sm font-medium text-slate-900">{quotation.customers?.name ?? '—'}</p>
            <p className="text-sm text-slate-500">{quotation.customers?.phone}</p>
            {quotation.customers?.address && (
              <p className="text-sm text-slate-500">{quotation.customers.address}</p>
            )}
          </div>
          <div className="text-right text-sm text-slate-500">
            <p>
              Quotation No:{' '}
              <span className="font-semibold text-slate-900">{quotation.quotation_number}</span>
            </p>
            <p className="mt-1">Date: {formatDate(quotation.created_at)}</p>
            {quotation.valid_until && (
              <p className="mt-1">Valid Until: {formatDate(quotation.valid_until)}</p>
            )}
            {quotation.notes && (
              <>
                <p className="mt-2 mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                  Notes
                </p>
                <p className="whitespace-pre-wrap">{quotation.notes}</p>
              </>
            )}
            <span
              className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                quotation.invoice_series === 'gst'
                  ? 'bg-violet-50 text-violet-600'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {quotation.invoice_series === 'gst' ? 'GST' : 'Non-GST'}
            </span>
          </div>
        </div>

        <div className="mb-8 overflow-hidden rounded-lg border border-slate-300">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-300 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <th className="border-r border-slate-300 px-4 py-2.5">Item</th>
                <th className="border-r border-slate-300 px-4 py-2.5">Qty</th>
                <th className="border-r border-slate-300 px-4 py-2.5">Unit Price</th>
                <th className="px-4 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr
                  key={item.id}
                  className={`border-b border-slate-200 last:border-b-0 ${
                    index % 2 === 1 ? 'bg-slate-50' : 'bg-white'
                  }`}
                >
                  <td className="border-r border-slate-200 px-4 py-2.5">
                    <p className="font-medium text-slate-900">{item.item_name}</p>
                    <p className="text-xs text-slate-400">
                      {formatLabel(item.item_type)}
                      {item.serial_imei ? ` · IMEI ${item.serial_imei}` : ''}
                      {item.ram ? ` · ${item.ram}` : ''}
                      {item.storage ? ` · ${item.storage}` : ''}
                    </p>
                    {item.hsn_code && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {item.item_type === 'service' ? 'SAC' : 'HSN'}: {item.hsn_code}
                      </p>
                    )}
                    {item.description && (
                      <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
                    )}
                  </td>
                  <td className="border-r border-slate-200 px-4 py-2.5 text-slate-500">
                    {item.quantity}
                  </td>
                  <td className="border-r border-slate-200 px-4 py-2.5 text-slate-500">
                    {formatCurrencyExact(item.unit_price)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-700">
                    {formatCurrencyExact(item.total_price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between text-slate-500">
              <span>Items Subtotal</span>
              <span>
                {formatCurrencyExact(items.reduce((sum, item) => sum + item.total_price, 0))}
              </span>
            </div>
            {quotation.labor_charge > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>
                  Labor Charge{quotation.labor_sac_code ? ` (${quotation.labor_sac_code})` : ''}
                </span>
                <span>{formatCurrencyExact(quotation.labor_charge)}</span>
              </div>
            )}
            {quotation.discount > 0 && (
              <div className="flex justify-between text-slate-500">
                <span>Discount</span>
                <span>−{formatCurrencyExact(quotation.discount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-2 font-medium text-slate-700">
              <span>Taxable Value</span>
              <span>{formatCurrencyExact(quotation.subtotal)}</span>
            </div>
            {quotation.invoice_series === 'gst' && (
              <>
                <div className="flex justify-between text-slate-500">
                  <span>CGST (9%)</span>
                  <span>{formatCurrencyExact(quotation.cgst_amount)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>SGST (9%)</span>
                  <span>{formatCurrencyExact(quotation.sgst_amount)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-slate-900">
              <span>Total</span>
              <span>{formatCurrencyExact(quotation.total)}</span>
            </div>
          </div>
        </div>

        <PrintFooter note="This quotation is valid until the date noted above." />
      </div>
    </div>
  )
}
