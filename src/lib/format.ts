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

// Plain Math.round(n * 100) / 100 misrounds boundary cases like 76.195 to
// 76.19 instead of 76.20 -- floating-point subtraction (e.g. 999 - 846.61)
// lands a hair below the true value, and that noise flips which side of the
// boundary the rounding falls on. The epsilon nudges past that noise without
// affecting any real (non-boundary) value.
export function round2(value: number) {
  return Math.round((value + 1e-8) * 100) / 100
}

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

// Browser-local YYYY-MM-DD, for <input type="date"> defaults/max. Deliberately
// NOT `new Date().toISOString().slice(0, 10)` -- toISOString() is always UTC,
// so between 00:00-05:29 IST that would yield yesterday's date in India.
export function localDateString(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatLabel(value: string | null | undefined) {
  if (!value) return '—'
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
