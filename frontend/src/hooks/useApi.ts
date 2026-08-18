import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  Breakdown, Stats, NetworthData, MonthlyChange, Allocation,
  Holding, Transaction, CashAccount, SuperHolding, Snapshot,
  CGTResult, SyncStatus, SyncResponse, SyncJob, Milestone, Dividend, HoldingGroup,
  CompounterData, IbkrCredentialsStatus, IbkrSyncJob, TaxIncomeResult, TaxSettings,
  ClosedPositionsResult,
  PerformanceData,
} from '../types'
import { getToken, clearSession } from '../lib/auth'
import { apiUrl } from '../lib/apiBase'

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function handleAuthError(res: Response) {
  if (res.status === 401) {
    // Token missing/expired/invalid — clear it so the app falls back to the
    // login screen instead of silently failing every subsequent request.
    clearSession()
  }
}

const get = async <T>(url: string): Promise<T> => {
  const res = await fetch(apiUrl(url), { headers: { ...authHeaders() } })
  if (!res.ok) { await handleAuthError(res); throw new Error(`${url} ${res.status}`) }
  return res.json()
}

const post = async <T>(url: string, body?: unknown): Promise<T> => {
  const res = await fetch(apiUrl(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) { await handleAuthError(res); throw new Error(`${url} ${res.status}`) }
  return res.json()
}

const del = async (url: string) => {
  const res = await fetch(apiUrl(url), { method: 'DELETE', headers: { ...authHeaders() } })
  if (!res.ok) { await handleAuthError(res); throw new Error(`${url} ${res.status}`) }
  return res.json()
}

const put = async <T>(url: string, body: unknown): Promise<T> => {
  const res = await fetch(apiUrl(url), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  })
  if (!res.ok) { await handleAuthError(res); throw new Error(`${url} ${res.status}`) }
  return res.json()
}

export const useDashboardLayout = () =>
  useQuery({
    queryKey: ['dashboard-layout'],
    queryFn: () => get<{
      widget_order: string[] | null
      widget_visible: Record<string, boolean> | null
      stat_keys: string[] | null
      alloc_widgets: unknown[] | null
      /** Per-widget column span overrides, keyed by widget id. */
      widget_spans: Record<string, number> | null
    }>('/api/dashboard-layout'),
  })

export const useSaveDashboardLayout = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      widget_order?: string[]
      widget_visible?: Record<string, boolean>
      stat_keys?: string[]
      alloc_widgets?: unknown[]
      widget_spans?: Record<string, number>
    }) => post('/api/dashboard-layout', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard-layout'] }),
  })
}

export const useBreakdown = () =>
  useQuery({ queryKey: ['breakdown'], queryFn: () => get<Breakdown>('/api/breakdown'), refetchInterval: 60_000 })

export const useStats = () =>
  useQuery({ queryKey: ['stats'], queryFn: () => get<Stats>('/api/stats'), refetchInterval: 60_000 })

export const useNetworth = () =>
  useQuery({ queryKey: ['networth'], queryFn: () => get<NetworthData>('/api/networth') })

export const usePerformance = (range: string, benchmark: string) =>
  useQuery({
    queryKey: ['performance', range, benchmark],
    queryFn: () => get<PerformanceData>(
      `/api/performance?range=${encodeURIComponent(range)}&benchmark=${encodeURIComponent(benchmark)}`),
  })

export const useMonthlyChange = () =>
  useQuery({ queryKey: ['monthly-change'], queryFn: () => get<MonthlyChange>('/api/monthly-change') })

export const useCompounder = () =>
  useQuery({ queryKey: ['compounder'], queryFn: () => get<CompounterData>('/api/compounder') })

export const useAllocation = () =>
  useQuery({ queryKey: ['allocation'], queryFn: () => get<Allocation>('/api/allocation') })

export const useCountryOverrides = () =>
  useQuery({ queryKey: ['country-overrides'], queryFn: () => get<Record<string, string>>('/api/country-overrides') })

export const useSaveCountryOverrides = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (overrides: Record<string, string>) => post('/api/country-overrides', overrides),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['country-overrides'] })
      qc.invalidateQueries({ queryKey: ['allocation'] })
    },
  })
}

export const usePortfolio = () =>
  useQuery({ queryKey: ['portfolio'], queryFn: () => get<Holding[]>('/api/portfolio'), refetchInterval: 60_000 })

export const useClosedPositions = () =>
  useQuery({
    queryKey: ['closed-positions'],
    queryFn: () => get<ClosedPositionsResult>('/api/portfolio/closed'),
  })

/** Force an immediate price refresh, then re-read everything that shows a price. */
export const useRefreshPrices = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => post<{ ok: boolean; symbols_refreshed: number; symbols_total: number; market_active: boolean }>(
      '/api/prices/refresh'),
    onSuccess: () => {
      // sync-status included so the "last updated" label refetches — without it
      // the refresh landed new prices while the clock on screen stayed frozen.
      for (const k of ['portfolio', 'stats', 'breakdown', 'extended-hours', 'networth',
                       'monthly-change', 'sync-status', 'performance', 'range-performance'])
        qc.invalidateQueries({ queryKey: [k] })
    },
  })
}

export const useTransactions = () =>
  useQuery({ queryKey: ['transactions'], queryFn: () => get<Transaction[]>('/api/transactions') })

export const useCashAccounts = () =>
  useQuery({ queryKey: ['cash-accounts'], queryFn: () => get<CashAccount[]>('/api/cash-accounts') })

export const useSuperHoldings = () =>
  useQuery({ queryKey: ['super-holdings'], queryFn: () => get<SuperHolding[]>('/api/super-holdings') })

export const useSnapshots = () =>
  useQuery({ queryKey: ['snapshots'], queryFn: () => get<Snapshot[]>('/api/snapshots') })

export const useSyncStatus = () =>
  useQuery({ queryKey: ['sync-status'], queryFn: () => get<SyncStatus[]>('/api/sync-status') })

export const useCGT = (from: string, to: string, method: string, enabled: boolean, priorLosses?: number) =>
  useQuery({
    queryKey: ['cgt', from, to, method, priorLosses ?? null],
    queryFn: () => get<CGTResult>(
      `/api/cgt?from=${from}&to=${to}&method=${method}` +
      (priorLosses != null ? `&prior_losses=${priorLosses}` : '')),
    enabled,
  })

export const useTaxIncome = (from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: ['tax-income', from, to],
    queryFn: () => get<TaxIncomeResult>(`/api/tax/income?from=${from}&to=${to}`),
    enabled,
  })

export const useExtendedHours = () =>
  useQuery({
    queryKey: ['extended-hours'],
    queryFn: () => get<{
      session: string; label: string; market_state: string; as_of?: string
      total_aud: number; pct: number; us_value_aud: number
      covered: number; total_holdings: number
      movers: { ticker: string; delta_aud: number; pct: number; pct_aud: number; price: number }[]
      /** Every quoted symbol, for the Allocation treemap. pct is the move in the
       *  share's own currency; pct_aud also carries the exchange rate since the close. */
      by_ticker?: Record<string, { pct: number; pct_aud: number; delta_aud: number }>
      audusd_close?: number
      audusd_live?: number
      note: string | null
    }>('/api/portfolio/extended-hours'),
    // Server caches for 60s; poll a little slower than that.
    refetchInterval: 90_000,
  })

export const useTaxSettings = () =>
  useQuery({ queryKey: ['tax-settings'], queryFn: () => get<TaxSettings>('/api/tax/settings') })

export const useTaxLock = () =>
  useQuery({
    queryKey: ['tax-lock'],
    queryFn: () => get<{
      locked_disposals: number
      last_locked_at: string | null
      locked_to: string | null
      disposals: { sell_id: number; date: string; ticker: string; method: string; parcels: number; units: number }[]
    }>('/api/tax/lock'),
  })

export const useSetTaxLock = () => {
  const qc = useQueryClient()
  const done = () => {
    qc.invalidateQueries({ queryKey: ['tax-lock'] })
    qc.invalidateQueries({ queryKey: ['cgt'] })
  }
  return {
    lock: useMutation({ mutationFn: (v: { to: string; method?: string }) => post('/api/tax/lock', v), onSuccess: done }),
    unlock: useMutation({ mutationFn: (to?: string) => del(`/api/tax/lock${to ? `?to=${to}` : ''}`), onSuccess: done }),
  }
}

export const useSaveTaxSettings = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (s: { entity_type: string; allocation_method: string }) =>
      post('/api/tax/settings', s),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tax-settings'] })
      qc.invalidateQueries({ queryKey: ['cgt'] })
    },
  })
}

const invalidateTransactionDependents = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['transactions'] })
  qc.invalidateQueries({ queryKey: ['portfolio'] })
  qc.invalidateQueries({ queryKey: ['breakdown'] })
  qc.invalidateQueries({ queryKey: ['stats'] })
  qc.invalidateQueries({ queryKey: ['networth'] })
  qc.invalidateQueries({ queryKey: ['monthly-change'] })
  qc.invalidateQueries({ queryKey: ['cgt'] })
  qc.invalidateQueries({ queryKey: ['holding-groups'] })
  qc.invalidateQueries({ queryKey: ['milestones'] })
}

export const useAddTransaction = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Transaction>) => post('/api/transactions', data),
    onSuccess: () => invalidateTransactionDependents(qc),
  })
}

export const useUpdateTransaction = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Transaction> & { id: number }) => put(`/api/transactions/${id}`, data),
    onSuccess: () => invalidateTransactionDependents(qc),
  })
}

export const useDeleteTransaction = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (idx: number) => del(`/api/transactions/${idx}`),
    onSuccess: () => invalidateTransactionDependents(qc),
  })
}

export const useSaveCashAccounts = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (accounts: CashAccount[]) => post('/api/cash-accounts', accounts),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-accounts'] })
      qc.invalidateQueries({ queryKey: ['breakdown'] })
      qc.invalidateQueries({ queryKey: ['networth'] })
    },
  })
}

export const useSaveSuperHoldings = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (holdings: SuperHolding[]) => post('/api/super-holdings', holdings),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['super-holdings'] })
      qc.invalidateQueries({ queryKey: ['allocation'] })
    },
  })
}

const invalidateSnapshotDependents = (qc: ReturnType<typeof useQueryClient>) => {
  // snapshots feeds breakdown/stats/networth/monthly-change/milestones (super or
  // cash can be a tracked milestone metric) — invalidating only 'snapshots' left
  // the Superannuation card showing a stale value after a real, successful update.
  qc.invalidateQueries({ queryKey: ['snapshots'] })
  qc.invalidateQueries({ queryKey: ['breakdown'] })
  qc.invalidateQueries({ queryKey: ['stats'] })
  qc.invalidateQueries({ queryKey: ['networth'] })
  qc.invalidateQueries({ queryKey: ['monthly-change'] })
  qc.invalidateQueries({ queryKey: ['milestones'] })
}

export const useAddSnapshot = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { date: string; super: number; cash: number }) =>
      post('/api/snapshots', data),
    onSuccess: () => invalidateSnapshotDependents(qc),
  })
}

export const useDeleteSnapshot = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (snapDate: string) => del(`/api/snapshots/${snapDate}`),
    onSuccess: () => invalidateSnapshotDependents(qc),
  })
}

export const useSync = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (force?: boolean): Promise<SyncJob> => {
      // Fire-and-forget start, then poll until done
      const job = await post<SyncJob>(`/api/sync${force ? '?force=true' : ''}`)
      const poll = async (): Promise<SyncJob> => {
        const progress = await get<SyncJob>(`/api/sync/progress/${job.job_id}`)
        if (progress.status === 'running') {
          await new Promise(r => setTimeout(r, 1000))
          return poll()
        }
        return progress
      }
      return poll()
    },
    onSuccess: () => { qc.invalidateQueries() },
  })
}

/** Per-holding value + return scoped to a time window, for the treemap. */
export const useRangePerformance = (range: string) =>
  useQuery({
    queryKey: ['range-performance', range],
    queryFn: () => get<{ ticker: string; value_aud: number; return_pct: number }[]>(
      `/api/portfolio/range-performance?range=${encodeURIComponent(range)}`),
  })

/** Recent closes per ticker, for the trend column in the holdings table. */
export const useSparklines = () =>
  useQuery({ queryKey: ['sparklines'], queryFn: () => get<Record<string, number[]>>('/api/portfolio/sparklines') })

export const useIbkrCredentials = () =>
  useQuery({ queryKey: ['ibkr-credentials'], queryFn: () => get<IbkrCredentialsStatus>('/api/ibkr/credentials') })

export const useSaveIbkrCredentials = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { flex_token: string; query_id: string }) => post('/api/ibkr/credentials', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ibkr-credentials'] }),
  })
}

export const useDeleteIbkrCredentials = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => del('/api/ibkr/credentials'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ibkr-credentials'] }),
  })
}

export const useIbkrSync = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<IbkrSyncJob> => {
      const job = await post<IbkrSyncJob>('/api/ibkr/sync')
      const poll = async (): Promise<IbkrSyncJob> => {
        const progress = await get<IbkrSyncJob>(`/api/ibkr/sync/progress/${job.job_id}`)
        if (progress.status === 'running') {
          await new Promise(r => setTimeout(r, 1000))
          return poll()
        }
        return progress
      }
      return poll()
    },
    onSuccess: () => {
      qc.invalidateQueries()
      qc.invalidateQueries({ queryKey: ['ibkr-credentials'] })
    },
  })
}

export const useMilestones = () =>
  useQuery({ queryKey: ['milestones'], queryFn: () => get<Milestone[]>('/api/milestones') })

export const useAddMilestone = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<Milestone, 'id'>) => post('/api/milestones', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['milestones'] }),
  })
}

export const useUpdateMilestone = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Milestone) => put(`/api/milestones/${data.id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['milestones'] }),
  })
}

export const useDeleteMilestone = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => del(`/api/milestones/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['milestones'] }),
  })
}

export const useDividends = () =>
  useQuery({ queryKey: ['dividends'], queryFn: () => get<Dividend[]>('/api/dividends') })

export const useAddDividend = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Dividend>) => post('/api/dividends', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dividends'] }),
  })
}

export const useUpdateDividendFranking = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, franking_pct }: { id: number; franking_pct: number }) =>
      put(`/api/dividends/${id}`, { franking_pct }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dividends'] }),
  })
}

export const useDeleteDividend = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => del(`/api/dividends/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dividends'] }),
  })
}

export const useSyncDividends = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => post<SyncResponse>('/api/dividends/sync'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dividends'] }),
  })
}

export const useHoldingGroups = () =>
  useQuery({
    queryKey: ['holding-groups'],
    queryFn: () => get<{ groups: HoldingGroup[]; grand_total: Omit<HoldingGroup, 'id' | 'name' | 'symbols'> }>('/api/holding-groups'),
  })

export const useAddHoldingGroup = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; symbols: string[] }) => post('/api/holding-groups', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['holding-groups'] }),
  })
}

export const useUpdateHoldingGroup = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name, symbols }: { id: number; name: string; symbols: string[] }) =>
      put(`/api/holding-groups/${id}`, { name, symbols }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['holding-groups'] }),
  })
}

export const useDeleteHoldingGroup = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => del(`/api/holding-groups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['holding-groups'] }),
  })
}