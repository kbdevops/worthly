import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  Breakdown, Stats, NetworthData, MonthlyChange, Allocation,
  Holding, Transaction, CashAccount, SuperHolding, Snapshot,
  CGTResult, SyncStatus, SyncResponse, Milestone,
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

export const useCGT = (from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: ['cgt', from, to],
    queryFn: () => get<CGTResult>(`/api/cgt?from=${from}&to=${to}`),
    enabled,
  })

export const useAddTransaction = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Transaction>) => post('/api/transactions', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  })
}

export const useDeleteTransaction = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (idx: number) => del(`/api/transactions/${idx}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['snapshots'] }),
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