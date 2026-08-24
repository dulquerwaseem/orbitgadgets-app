import { Workbook } from 'exceljs'
import { formatDate, formatLabel } from './format'

export interface GstInvoiceExportRow {
  id: string
  invoice_number: string
  created_at: string
  customer_gst: string | null
  taxable_value: number
  cgst_amount: number
  sgst_amount: number
  final_price: number
  payment_status: string
  customers: { name: string } | null
}

export interface GstInvoiceItemExportRow {
  invoice_id: string
  item_name: string
  hsn_code: string | null
  item_type: string
  quantity: number
  unit_price: number
  total_price: number
}

interface ExportDateRange {
  start: Date | null
  end: Date | null
}

const currencyFormat = '#,##0.00'

function formatFileDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Falls back to the actual min/max invoice dates when the range is unbounded
// (the "All Time" preset, or a custom range with only one side filled in).
export function resolveExportFileDates(
  range: ExportDateRange,
  invoices: { created_at: string }[],
): { from: string; to: string } {
  if (range.start && range.end) {
    return { from: formatFileDate(range.start), to: formatFileDate(range.end) }
  }
  if (invoices.length === 0) {
    const today = formatFileDate(new Date())
    return { from: today, to: today }
  }
  const times = invoices.map((inv) => new Date(inv.created_at).getTime())
  return {
    from: formatFileDate(new Date(Math.min(...times))),
    to: formatFileDate(new Date(Math.max(...times))),
  }
}

export async function downloadGstSalesExcel(
  invoices: GstInvoiceExportRow[],
  items: GstInvoiceItemExportRow[],
  dateRange: ExportDateRange,
): Promise<void> {
  const workbook = new Workbook()

  const summarySheet = workbook.addWorksheet('Sales Summary')
  summarySheet.columns = [
    { header: 'Invoice Number', key: 'invoiceNumber', width: 18 },
    { header: 'Invoice Date', key: 'invoiceDate', width: 14 },
    { header: 'Customer Name', key: 'customerName', width: 24 },
    { header: 'Customer GSTIN', key: 'customerGstin', width: 18 },
    { header: 'Taxable Value', key: 'taxableValue', width: 16, style: { numFmt: currencyFormat } },
    { header: 'CGST (9%)', key: 'cgst', width: 14, style: { numFmt: currencyFormat } },
    { header: 'SGST (9%)', key: 'sgst', width: 14, style: { numFmt: currencyFormat } },
    { header: 'Total Invoice Value', key: 'totalValue', width: 18, style: { numFmt: currencyFormat } },
    { header: 'Payment Status', key: 'paymentStatus', width: 16 },
  ]
  summarySheet.getRow(1).font = { bold: true }
  summarySheet.addRows(
    invoices.map((inv) => ({
      invoiceNumber: inv.invoice_number,
      invoiceDate: formatDate(inv.created_at),
      customerName: inv.customers?.name ?? '',
      customerGstin: inv.customer_gst ?? '',
      taxableValue: inv.taxable_value,
      cgst: inv.cgst_amount,
      sgst: inv.sgst_amount,
      totalValue: inv.final_price,
      paymentStatus: formatLabel(inv.payment_status),
    })),
  )

  const invoiceById = new Map(invoices.map((inv) => [inv.id, inv]))

  const itemSheet = workbook.addWorksheet('Item Detail')
  itemSheet.columns = [
    { header: 'Invoice Number', key: 'invoiceNumber', width: 18 },
    { header: 'Invoice Date', key: 'invoiceDate', width: 14 },
    { header: 'Item Name', key: 'itemName', width: 28 },
    { header: 'HSN/SAC Code', key: 'hsnCode', width: 14 },
    { header: 'Item Type', key: 'itemType', width: 14 },
    { header: 'Quantity', key: 'quantity', width: 10 },
    { header: 'Unit Price', key: 'unitPrice', width: 14, style: { numFmt: currencyFormat } },
    { header: 'Line Total', key: 'lineTotal', width: 14, style: { numFmt: currencyFormat } },
  ]
  itemSheet.getRow(1).font = { bold: true }
  itemSheet.addRows(
    items.map((item) => {
      const invoice = invoiceById.get(item.invoice_id)
      return {
        invoiceNumber: invoice?.invoice_number ?? '',
        invoiceDate: invoice ? formatDate(invoice.created_at) : '',
        itemName: item.item_name,
        hsnCode: item.hsn_code ?? '',
        itemType: formatLabel(item.item_type),
        quantity: item.quantity,
        unitPrice: item.unit_price,
        lineTotal: item.total_price,
      }
    }),
  )

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  const { from, to } = resolveExportFileDates(dateRange, invoices)
  const filename = `orbitgadgets-gst-sales-${from}-to-${to}.xlsx`

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
