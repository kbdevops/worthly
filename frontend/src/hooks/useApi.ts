import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  Breakdown, Stats, NetworthData, MonthlyChange, Allocation,
  Holding, Transaction, CashAccount, SuperHolding, Snapshot,
  CGTResult, SyncStatus, SyncResponse, Milestone, Dividend, HoldingGroup,
} from '../types'

const get = async <T>(url: string): Promise<T> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

const post = async <T>(url: string, body?: unknown): Promise<T> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

const del = async (url: string) => {
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

const put = async <T>(url: string, body: unknown): Promise<T> => {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

export const useBreakdown = () =>
  useQuery({ queryKey: ['breakdown'], queryFn: () => get<Breakdown>('/api/breakdown') })

export const useStats = () =>
  useQuery({ queryKey: ['stats'], queryFn: () => get<Stats>('/api/stats') })

export const useNetworth = () =>
  useQuery({ queryKey: ['networth'], queryFn: () => get<NetworthData>('/api/networth') })

export const useMonthlyChange = () =>
  useQuery({ queryKey: ['monthly-change'], queryFn: () => get<MonthlyChange>('/api/monthly-change') })

export const useAllocation = () =>
  useQuery({ queryKey: ['allocation'], queryFn: () => get<Allocation>('/api/allocation') })

export const usePortfolio = () =>
  useQuery({ queryKey: ['portfolio'], queryFn: () => get<Holding[]>('/api/portfolio') })

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

export const useCGT = (from: string, to: string, method: string, enabled: boolean) =>
  useQuery({
    queryKey: ['cgt', from, to, method],
    queryFn: () => get<CGTResult>(`/api/cgt?from=${from}&to=${to}&method=${method}`),
    enabled,
  })

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

export const useAddSnapshot = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { date: string; super: number; cash: number }) =>
      post('/api/snapshots', data),
    onSuccess: () => {
      // snapshots feeds breakdown/stats/networth/monthly-change/milestones (super or
      // cash can be a tracked milestone metric) — invalidating only 'snapshots' left
      // the Superannuation card showing a stale value after a real, successful update.
      qc.invalidateQueries({ queryKey: ['snapshots'] })
      qc.invalidateQueries({ queryKey: ['breakdown'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['networth'] })
      qc.invalidateQueries({ queryKey: ['monthly-change'] })
      qc.invalidateQueries({ queryKey: ['milestones'] })
    },
  })
}

export const useSync = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (force?: boolean) =>
      post<SyncResponse>(`/api/sync${force ? '?force=true' : ''}`),
    onSuccess: () => {
      qc.invalidateQueries()
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