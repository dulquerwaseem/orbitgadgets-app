const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

const preciseCurrencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const dateFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return currencyFormatter.format(value)
}

// Money on an invoice should never lose paise, unlike list-view display.
export function formatCurrencyExact(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return preciseCurrencyFormatter.format(value)
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return dateFormatter.format(new Date(value))
}

export function formatLabel(value: string | null | undefined) {
  if (!value) return '—'
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
