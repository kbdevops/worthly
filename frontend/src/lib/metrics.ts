import { fmtCurrency, fmtPct } from './utils'
import type { Breakdown } from '../types'

/** The things in this app you can point a number at.
 *
 *  Shared because two screens now offer the same list and drifting labels would be
 *  worse than duplication: a goal tracking "Net Worth" and a projection seeded from
 *  "Total Net Worth" read as different quantities when they are the same one.
 *
 *  Labels only — the live VALUE of a milestone metric is resolved server-side and
 *  arrives as current_value, so this deliberately does not try to compute it.
 */
export const METRICS = [
  { id: 'portfolio',  label: 'Portfolio Value',  fmt: (v: number) => fmtCurrency(v) },
  { id: 'networth',   label: 'Net Worth',        fmt: (v: number) => fmtCurrency(v) },
  { id: 'cash',       label: 'Cash',             fmt: (v: number) => fmtCurrency(v) },
  { id: 'super',      label: 'Super',            fmt: (v: number) => fmtCurrency(v) },
  { id: 'return_aud', label: 'Total Return ($)', fmt: (v: number) => fmtCurrency(v) },
  { id: 'return_pct', label: 'Total Return (%)', fmt: (v: number) => fmtPct(v) },
] as const

export type MetricId = (typeof METRICS)[number]['id']

/* Balances you currently hold, so they can seed an opening amount. Total Return is
 * excluded on purpose: as a percentage it is not an amount at all, and as dollars it is
 * a result rather than a balance — projecting growth from it would compound a gain you
 * have already counted.
 *
 * Split into a total and its parts rather than one flat list, because the two behave
 * differently and the difference should be expressible in data instead of an `id ===
 * 'networth'` check buried in a click handler. The parts add together; the total is
 * exactly their sum, so pairing it with any part would count that part twice. */
export const COMPONENT_METRICS = ['portfolio', 'cash', 'super'] as const
export const TOTAL_METRIC = 'networth' as const
export const BALANCE_METRICS = [TOTAL_METRIC, ...COMPONENT_METRICS] as const
export type BalanceMetricId = (typeof BALANCE_METRICS)[number]

/** Current AUD value of a balance metric. Returns null when the breakdown hasn't
 *  loaded, so callers can hide the control rather than offer a button that inserts 0. */
export function balanceValue(id: BalanceMetricId, bd: Breakdown | undefined): number | null {
  if (!bd) return null
  switch (id) {
    case 'portfolio': return bd.portfolio
    case 'cash':      return bd.cash
    case 'super':     return bd.super
    // Deliberately summed rather than read off bd.total: the hero adds the same three
    // legs, and a net worth that disagrees with its own composition is the bug this
    // app keeps finding.
    case 'networth':  return bd.portfolio + bd.super + bd.cash
  }
}

export const metricLabel = (id: string) =>
  METRICS.find(m => m.id === id)?.label ?? id
