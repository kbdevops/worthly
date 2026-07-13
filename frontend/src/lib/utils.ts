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
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })
}
