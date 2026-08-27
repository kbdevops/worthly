import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtCurrency(n: number, digits = 2): string {
  if (n == null || isNaN(n)) return '$0.00'
  return '$' + Math.abs(n).toLocaleString('en-AU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** Short form for tight spaces — $1.2m / $451.1k / $840. */
export function fmtCurrencyCompact(n: number): string {
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}m`
  if (a >= 1_000)     return `${sign}$${(a / 1_000).toFixed(a >= 100_000 ? 1 : 1)}k`
  return `${sign}$${a.toFixed(0)}`
}

export function fmtCurrencySigned(n: number, digits = 2): string {
  if (n == null || isNaN(n)) return '$0.00'
  const prefix = n < 0 ? '-$' : '$'
  return prefix + Math.abs(n).toLocaleString('en-AU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function fmtLocal(n: number, currency: string): string {
  if (n == null || isNaN(n)) return '0.00'
  const prefix = currency === 'USD' ? 'US$' : '$'
  return prefix + Math.abs(n).toLocaleString('en-AU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })
}

export function fmtPct(n: number, digits = 2): string {
  if (n == null || isNaN(n)) return '0.00%'
  return (n >= 0 ? '+' : '') + n.toFixed(digits) + '%'
}

export function fmtDate(d: string): string {
  if (!d) return ''
  // A bare YYYY-MM-DD is parsed by Date as UTC midnight, which then renders as the
  // PREVIOUS day in any negative-UTC-offset timezone — from US Central every date in
  // the app read a day early, and a trade stored as 2025-10-13 displayed as 12 Oct.
  // Build from the parts so it's local midnight and the calendar date is preserved
  // whatever the viewer's timezone. Anything carrying a time falls through to Date,
  // which is correct for a real instant.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim())
  const dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d)
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}
