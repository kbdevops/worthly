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
  total_principal: number
  best_performer: string
  best_performer_pct: number
  worst_performer: string
  worst_performer_pct: number
  all_time_high: number
  all_time_high_date: string | null
  daily_ath: number
  daily_ath_date: string | null
  day_pl: number
  day_pl_pct: number
  cost_basis: number
  /** Legacy cost-basis CAGR. Understates badly — ignores sales and dividends and
   *  stretches all capital back to the first buy. No card reads it; use mwr_pct. */
  cagr: number
  cagr_years: number
  cagr_annualised: boolean
  /** Money-weighted (XIRR) return p.a. over the real dated cash flows. Null when
   *  the flows don't bracket a root or there's no history. */
  mwr_pct: number | null
  mwr_years: number
  /** False under one year, where mwr_pct is a plain cumulative return instead. */
  mwr_annualised: boolean
  mwr_pct_ex_income: number | null
  /** Lifetime realised gain, average-cost basis, including closed positions. */
  realised_gain: number
  income_total: number
  franking_total: number
  /** Income received since 1 July (Australian FY). */
  income_fy: number
  /** unrealised + realised + income. */
  total_return_all: number
  dividend_income: number
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
  /** First day of the month the change occurred IN — not the boundary that closes it. */
  months: string[]
  /** Closing boundary of each bar, so the UI can state the span rather than imply it. */
  period_end: string[]
  change: number[]
  change_pct: number[]
  sources: string[]
  /** True for the trailing month still in progress; its bar is a part-month total. */
  is_mtd: boolean[]
}

export interface AllocationCountry {
  value: number
  pct: number
}

export interface Allocation {
  countries: Record<string, AllocationCountry>
}

export interface Holding {
  symbol: string
  ticker: string
  exchange: string
  name: string
  units: number
  cost_aud: number
  /** Every dollar ever put into the ticker — unlike cost_aud, not reduced by sells. */
  gross_cost_aud: number
  avg_price: number
  avg_price_aud: number
  current_price: number
  current_price_aud: number
  value_aud: number
  return_aud: number
  return_pct: number
  /** Lifetime dividends received, in AUD. Dollars only — see app.py for why
   *  this is never expressed as a % of cost_aud. */
  income_aud: number
  /** Australian franking credits attached to that income (a tax credit, not cash). */
  franking_aud: number
  /** Gain banked on parcels of this holding already sold, average-cost basis. */
  realised_aud: number
  /** return_aud + realised_aud + income_aud + franking_aud — the app-wide definition
   *  of total return. Summed across active and closed positions it reconciles to
   *  total_return_all in /api/stats. */
  total_return_aud: number
  /** total_return_aud / gross_cost_aud. Lifetime return on the whole position, not
   *  just the units still held — so it differs from return_pct on anything ever
   *  trimmed. Not annualised. */
  total_return_pct: number
  /* Sharesight-style split of total_return_aud. capital + currency + income +
   * franking == total_return_aud, and the four percentages likewise sum to
   * total_return_pct — they all divide by gross_cost_aud. Note capital_gain_aud
   * EXCLUDES currency, unlike return_aud which is the combined AUD move. */
  capital_gain_aud: number
  capital_gain_pct: number
  /** Gain or loss purely from the exchange rate moving. Exactly 0 on AUD holdings. */
  currency_gain_aud: number
  currency_gain_pct: number
  income_pct: number
  franking_pct_of_cost: number
  daily_change: number
  daily_change_pct: number
  weight: number
  sector: string
  industry: string
  logo_url: string
  currency: string
  buys_count: number
  sells_count: number
  last_synced: string | null
}

export interface Transaction {
  id?: number
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
  price_gain_aud?: number
  fx_gain_aud?: number
  source?: string
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

export interface ClosedPosition {
  ticker: string
  exchange: string
  name: string
  currency: string
  invested: number
  proceeds: number
  realised_aud: number
  income_aud: number
  franking_aud: number
  total_return_aud: number
  return_pct: number | null
  buys_count: number
  sells_count: number
  first_date: string
  closed_date: string
  held_days: number
}

export interface ClosedPositionsResult {
  positions: ClosedPosition[]
  total_realised: number
  total_income: number
  total_return: number
}

export interface CGTGain {
  ticker: string
  name: string
  date: string
  acquired_date: string
  units: number
  proceeds: number
  cost: number
  gain: number
  discount_eligible: boolean
  discount_amount: number
}

export interface CGTResult {
  gains: CGTGain[]
  /** NET of losses. Use gross_gains/gross_losses for a reconcilable pair. */
  total_gain: number
  gross_gains: number
  gross_losses: number
  discounted_gains: number
  non_discounted_gains: number
  /** Capital gains attributed by trust (ETF) distributions, from annual tax statements. */
  distribution_gains_discounted: number
  distribution_gains_other: number
  /** Reduces cost base rather than being assessable. */
  tax_deferred_distributions: number
  losses_applied: number
  prior_losses_available: number
  prior_losses_applied: number
  losses_carried_forward: number
  net_capital_loss: number
  cgt_discount: number
  net_gain: number
  method: 'fifo' | 'lifo' | 'hifo'
  entity_type: string
  discount_rate: number
  warnings: string[]
}

export interface TaxIncomeItem {
  date: string
  ticker: string
  exchange: string
  currency: string
  income_aud: number
  franking_credit_aud: number
  withholding_tax_aud: number
  net_cash_aud: number
  capital_gain_aud: number
  tax_deferred_aud: number
  foreign: boolean
}

export interface TaxIncomeResult {
  gross_income: number
  franking_credits: number
  /** gross_income + franking_credits — what goes in the return. */
  assessable_income: number
  withholding_tax: number
  net_cash: number
  franked_income: number
  unfranked_income: number
  foreign_income: number
  foreign_tax_offsets: number
  capital_gain_distributions: number
  tax_deferred: number
  components_entered: boolean
  items: TaxIncomeItem[]
}

export interface TaxSettings {
  entity_type: string
  allocation_method: 'fifo' | 'lifo' | 'hifo'
  discount_rate: number
  entity_options: string[]
}

export interface SyncStatus {
  symbol: string
  last_synced: string
  cached_from: string
  cached_to: string
  last_error: string | null
  last_attempt: string | null
  record_count: number
  actual_from: string
  actual_to: string
  has_meta: boolean
}

export interface SyncJob {
  job_id: string
  status: 'running' | 'done' | 'error' | 'not_found'
  results?: SyncResult[]
  started_at?: string
  finished_at?: string
  error?: string
}

export interface SyncResult {
  symbol: string
  ok: boolean
  message: string
}

export interface SyncResponse {
  results: SyncResult[]
  message?: string
}

export interface IbkrCredentialsStatus {
  configured: boolean
  query_id: string | null
  last_synced: string | null
}

export interface IbkrDuplicateWarning {
  ibkr_txn_id: number
  manual_txn_id: number
  ticker: string
  date: string
  units: number
  price: number
}

export interface IbkrSyncJob {
  job_id?: string
  status: 'running' | 'done' | 'error' | 'not_found'
  results?: {
    trades_processed: number
    skipped_options: number
    skipped_currency: Record<string, number>
  }
  duplicate_warnings?: IbkrDuplicateWarning[]
  price_sync_results?: SyncResult[]
  started_at?: string
  finished_at?: string
  error?: string
}

export interface HoldingGroup {
  id: number
  name: string
  symbols: string[]
  value: number
  capital_gain: number
  income: number
  currency: string
  /** Capital only, over the cost of units still held — the "Capital %" column. */
  return_pct: number
  cost_basis: number
  realised: number
  franking: number
  /** Every dollar ever put into the group's symbols, sold parcels included. */
  gross_cost: number
  /** How many of `symbols` are still held. Sold-out symbols stay in the group so
   *  their realised gain and income remain part of its history. */
  open_count: number
  /** capital_gain + realised + income + franking — the app-wide definition. */
  total_return_aud: number
  /** total_return_aud over gross_cost. */
  total_return_pct: number
  /* Sharesight-style split, additive to total_return over gross_cost. capital_only
   * excludes currency; the older capital_gain field above keeps its original meaning
   * (unrealised, currency included). */
  capital_only_aud: number
  capital_only_pct: number
  currency_gain_aud: number
  currency_gain_pct: number
  income_pct: number
  franking_aud: number
}

export interface Dividend {
  id: number
  date: string
  symbol: string
  ticker: string
  exchange: string
  per_share: number
  units: number
  currency: 'AUD' | 'USD'
  gross_amount: number
  gross_amount_aud: number
  franking_pct: number
  franking_credit_aud: number
  withholding_tax_pct: number
  net_amount_aud: number
  source: 'yfinance' | 'manual'
}

export interface CompounterMonthPoint {
  date: string
  nw: number
  portfolio: number
  cash: number
  super: number
  source: string
  change_pct: number | null
  /** True for the calendar month still in progress; its value is month-to-date. */
  is_current_month: boolean
  /** Days since the previous point. The backend only counts a step in its rate stats
   *  (avg/best/worst month) when this is roughly a month. */
  period_days: number | null
}

export interface CompounterFYRow {
  fy: string
  nw_end: number
  prior_nw: number | null
  growth_dollar: number | null
  growth_pct: number | null
  best_month: number | null
  worst_month: number | null
  avg_mom: number | null
  portfolio_end: number
  cash_end: number
  port_pct: number | null
  months_count: number
}

export interface CompounterData {
  monthly: CompounterMonthPoint[]
  fy_rows: CompounterFYRow[]
  summary: {
    peak_nw: number
    avg_mom: number
    months_positive: number
    months_negative: number
  }
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