export interface Breakdown {
  portfolio: number
  cash: number
  super: number
  total: number
  stocks_active: number
  stocks_passive: number
}

export interface Stats {
  total_value: number
  total_cost: number
  total_return: number
  total_return_pct: number
  best_performer: string
  best_performer_pct: number
  worst_performer: string
  worst_performer_pct: number
  all_time_high: number
  all_time_high_date: string | null
}

export interface NetworthData {
  dates: string[]
  portfolio: number[]
  cash: number[]
  super: number[]
  net_worth: number[]
  return_val: number[]
}

export interface MonthlyChange {
  months: string[]
  change: number[]
  change_pct: number[]
}

export interface AllocationCountry {
  value: number
  pct: number
}

export interface Allocation {
  countries: Record<string, AllocationCountry>
}

export interface Holding {
  ticker: string
  exchange: string
  name: string
  units: number
  cost_aud: number
  avg_price: number
  avg_price_aud: number
  current_price: number
  current_price_aud: number
  value_aud: number
  return_aud: number
  return_pct: number
  daily_change: number
  daily_change_pct: number
  weight: number
  sector: string
  industry: string
  logo_url: string
  currency: string
  buys_count: number
  sells_count: number
}

export interface Transaction {
  date: string
  exchange: string
  ticker: string
  name: string
  action: string
  units: number
  price: number
  currency: string
  brokerage: number
  brokerage_currency: string
  exch_rate: number
  value: number
  current_price?: number
  gain_aud?: number
  gain_pct?: number
}

export interface CashAccount {
  institution: string
  type: string
  name: string
  balance: number
  country: string
}

export interface SuperHolding {
  name: string
  class: string
  allocation_pct: number
  country: string
}

export interface Snapshot {
  date: string
  super: number
  cash: number
}

export interface CGTGain {
  ticker: string
  name: string
  date: string
  units: number
  proceeds: number
  cost: number
  gain: number
  discount_eligible: boolean
  discount_amount: number
}

export interface CGTResult {
  gains: CGTGain[]
  total_gain: number
  losses_applied: number
  cgt_discount: number
  net_gain: number
}

export interface SyncStatus {
  symbol: string
  last_synced: string
  cached_from: string
  cached_to: string
  record_count: number
  actual_from: string
  actual_to: string
  has_meta: boolean
}

export interface Milestone {
  id: number
  date: string
  title: string
  description: string
  category: string
  value: number | null
  type: 'achievement' | 'goal'
  target_value: number | null
  /** target_value converted to AUD at the latest cached FX rate — recalculated live, so it moves with the market when currency is 'USD' */
  target_value_aud?: number | null
  current_value: number | null
  is_achieved: boolean
  /** @deprecated superseded by linked_metrics — kept for backward compatibility */
  linked_metric: string | null
  /** metrics tracked by this goal; when more than one is set they are summed live (e.g. cash + portfolio) */
  linked_metrics?: string[] | null
  /** currency the target_value is expressed in. USD targets are converted to AUD live for progress comparison. */
  currency?: 'AUD' | 'USD'
  achieved_date: string | null
}