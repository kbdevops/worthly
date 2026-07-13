import { useState, useMemo } from 'react'
import { Plus, Trash2, ChevronDown, ChevronUp, Clock, X, Search, Columns3 } from 'lucide-react'
import {
  useCashAccounts, useSuperHoldings, usePortfolio, useSnapshots, useBreakdown,
  useSaveCashAccounts, useSaveSuperHoldings, useAddSnapshot,
  useTransactions, useAddTransaction, useDeleteTransaction,
} from '../../hooks/useApi'
import { fmtCurrency, fmtPct, fmtDate } from '../../lib/utils'
import type { CashAccount, SuperHolding, Snapshot, Holding } from '../../types'
import HistorySlideout from '../layout/HistorySlideout'

const CARD = 'rounded-xl border border-[var(--border)] overflow-hidden'
const CARD_BG = { background: 'var(--bg-card)' }
const TH = 'px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider'
const TD = 'px-4 py-3 text-sm text-slate-300'
const TH2 = 'px-3 py-2.5 text-left text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap'
const TD2 = 'px-3 py-2.5 text-sm whitespace-nowrap'

const EXCHANGES = ['ASX', 'NASDAQ', 'NYSE', 'US']

type ColKey = 'units' | 'price' | 'currency' | 'fx' | 'brokerage' | 'cost' | 'gain_aud' | 'gain_pct'
const ALL_COLS: { key: ColKey; label: string }[] = [
  { key: 'units',     label: 'Units' },
  { key: 'price',     label: 'Price' },
  { key: 'currency',  label: 'Curr' },
  { key: 'fx',        label: 'FX Rate' },
  { key: 'brokerage', label: 'Brokerage' },
  { key: 'cost',      label: 'Cost (AUD)' },
  { key: 'gain_aud',  label: 'Gain ($)' },
  { key: 'gain_pct',  label: 'Gain (%)' },
]
const DEFAULT_COLS: ColKey[] = ['units', 'price', 'cost', 'gain_aud', 'gain_pct']

const blank_form = {
  date: new Date().toISOString().slice(0, 10),
  exchange: 'ASX', ticker: '', name: '', action: 'buy',
  units: '', price: '', brokerage: '',
}

function AddTxnModal({
  initial, title, onClose,
}: {
  initial: typeof blank_form
  title: string
  onClose: () => void
}) {
  const addTxn = useAddTransaction()
  const [form, setForm] = useState(initial)
  const currency = ['NASDAQ', 'NYSE', 'US'].includes(form.exchange) ? 'USD' : 'AUD'

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    addTxn.mutate({
      ...form,
      units: parseFloat(form.units),
      price: parseFloat(form.price) || 0,
      brokerage: parseFloat(form.brokerage) || 0,
    }, { onSuccess: onClose })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] p-5"
        style={{ background: 'var(--bg-card)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Date', key: 'date', type: 'date' },
              { label: 'Exchange', key: 'exchange', type: 'select', options: EXCHANGES },
              { label: 'Ticker', key: 'ticker', type: 'text', placeholder: 'e.g. VAS' },
              { label: 'Name', key: 'name', type: 'text', placeholder: 'Company name' },
              { label: 'Action', key: 'action', type: 'select', options: ['buy', 'sell', 'split'] },
              { label: 'Units', key: 'units', type: 'number', placeholder: '0' },
              { label: `Price (${currency})`, key: 'price', type: 'number', placeholder: '0.00' },
              { label: `Brokerage (${currency})`, key: 'brokerage', type: 'number', placeholder: '0.00' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs text-slate-400 mb-1">{f.label}</label>
                {f.type === 'select' ? (
                  <select value={form[f.key as keyof typeof form]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full px-2.5 py-1.5 rounded-lg text-sm bg-[var(--bg-elevated)] border border-[var(--border)] text-slate-300 focus:outline-none">
                    {f.options!.map(o => <option key={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type={f.type} value={form[f.key as keyof typeof form]} placeholder={f.placeholder}
                    onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full px-2.5 py-1.5 rounded-lg text-sm bg-[var(--bg-elevated)] border border-[var(--border)] text-slate-300 focus:outline-none"
                    disabled={form.action === 'split' && (f.key === 'price' || f.key === 'brokerage')}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-lg text-sm text-slate-400 border border-[var(--border)] hover:border-[var(--border-hover)]">Cancel</button>
            <button type="submit" disabled={addTxn.isPending || !form.ticker.trim()}
              className="flex-1 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
              {addTxn.isPending ? 'Adding…' : 'Add Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TickerSlideout({ holding, onClose }: { holding: Holding; onClose: () => void }) {
  const { data: txns = [] } = useTransactions()
  const deleteTxn = useDeleteTransaction()

  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [cols, setCols] = useState<ColKey[]>(DEFAULT_COLS)
  const [showColPicker, setShowColPicker] = useState(false)

  const tickerTxns = useMemo(() =>
    txns.filter(t => t.ticker === holding.ticker && t.exchange === holding.exchange),
    [txns, holding.ticker, holding.exchange]
  )

  const filtered = useMemo(() =>
    tickerTxns.filter(t =>
      !search || t.action.includes(search.toLowerCase()) || t.date.includes(search)
    ),
    [tickerTxns, search]
  )

  function toggleCol(key: ColKey) {
    setCols(c => c.includes(key) ? c.filter(k => k !== key) : [...c, key])
  }

  function handleDelete(idx: number) {
    if (!confirm('Delete this transaction?')) return
    deleteTxn.mutate(idx)
  }

  const visibleCols = ALL_COLS.filter(c => cols.includes(c.key))

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1" />
      <div
        className="w-full max-w-3xl h-full flex flex-col border-l border-[var(--border)] shadow-2xl"
        style={{ background: 'var(--bg-base)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]" style={{ background: 'var(--bg-card)' }}>
          <div className="flex items-center gap-3">
            {holding.logo_url && (
              <img src={holding.logo_url} alt="" className="w-8 h-8 rounded-lg"
                onError={e => (e.currentTarget.style.display = 'none')} />
            )}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-white">{holding.ticker}</h2>
                <span className="text-xs text-slate-400">{holding.exchange}</span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${holding.daily_change_pct >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                  {holding.daily_change_pct >= 0 ? '+' : ''}{holding.daily_change_pct?.toFixed(2)}%
                </span>
              </div>
              <p className="text-xs text-slate-500 truncate max-w-64">{holding.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"><X size={16} /></button>
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-4 gap-px border-b border-[var(--border)]" style={{ background: 'var(--border)' }}>
          {[
            { label: 'Value', value: fmtCurrency(holding.value_aud) },
            { label: 'Units', value: String(holding.units) },
            { label: 'Avg Cost', value: fmtCurrency(holding.avg_price_aud, 4) },
            { label: 'Return', value: `${fmtCurrency(holding.return_aud)} (${fmtPct(holding.return_pct)})`, color: holding.return_aud >= 0 ? '#10b981' : '#ef4444' },
          ].map(s => (
            <div key={s.label} className="px-4 py-3" style={{ background: 'var(--bg-card)' }}>
              <p className="text-xs text-slate-400 mb-0.5">{s.label}</p>
              <p className="text-sm font-medium" style={{ color: s.color ?? '#f8fafc' }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]" style={{ background: 'var(--bg-elevated)' }}>
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
              className="w-full pl-7 pr-3 py-1.5 rounded-lg text-xs bg-[var(--bg-card)] border border-[var(--border)] text-slate-300 placeholder-slate-600 focus:outline-none" />
          </div>

          {/* Column picker */}
          <div className="relative">
            <button onClick={() => setShowColPicker(s => !s)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 border border-[var(--border)] hover:border-[var(--border-hover)] transition-colors"
              style={{ background: 'var(--bg-card)' }}>
              <Columns3 size={13} /> Columns
            </button>
            {showColPicker && (
              <div className="absolute right-0 top-full mt-1 z-20 rounded-xl border border-[var(--border)] p-3 shadow-xl min-w-40"
                style={{ background: 'var(--bg-card)' }}>
                <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Show columns</p>
                <div className="space-y-1">
                  {ALL_COLS.map(c => (
                    <label key={c.key} className="flex items-center gap-2 py-1 cursor-pointer group">
                      <input type="checkbox" checked={cols.includes(c.key)} onChange={() => toggleCol(c.key)}
                        className="rounded" />
                      <span className="text-xs text-slate-300 group-hover:text-white">{c.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
            <Plus size={12} /> Add
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead style={{ background: 'var(--bg-elevated)' }} className="sticky top-0">
              <tr>
                <th className={TH2}>Date</th>
                <th className={TH2}>Action</th>
                {visibleCols.map(c => <th key={c.key} className={TH2}>{c.label}</th>)}
                <th className={TH2}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => {
                const realIdx = txns.findIndex(x => x === t)
                const gain = t.gain_aud ?? 0
                const gainPct = t.gain_pct ?? 0
                const isBuy = t.action === 'buy'
                return (
                  <tr key={i} className="border-t border-[var(--border)] hover:bg-white/5">
                    <td className={TD2 + ' text-slate-400'}>{fmtDate(t.date)}</td>
                    <td className={TD2}>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.action === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : t.action === 'sell' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                        {t.action}
                      </span>
                    </td>
                    {cols.includes('units')     && <td className={TD2 + ' text-slate-300'}>{t.units}</td>}
                    {cols.includes('price')     && <td className={TD2 + ' text-slate-300'}>{t.price}</td>}
                    {cols.includes('currency')  && <td className={TD2 + ' text-slate-500'}>{t.currency}</td>}
                    {cols.includes('fx')        && <td className={TD2 + ' text-slate-500'}>{t.exch_rate}</td>}
                    {cols.includes('brokerage') && <td className={TD2 + ' text-slate-500'}>{t.brokerage}</td>}
                    {cols.includes('cost')      && <td className={TD2 + ' text-white font-medium'}>{fmtCurrency(Math.abs(t.value))}</td>}
                    {cols.includes('gain_aud')  && (
                      <td className={TD2 + ' font-medium ' + (!isBuy ? 'text-slate-600' : gain >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {isBuy ? `${gain >= 0 ? '+' : ''}${fmtCurrency(gain)}` : '—'}
                      </td>
                    )}
                    {cols.includes('gain_pct')  && (
                      <td className={TD2 + ' font-medium ' + (!isBuy ? 'text-slate-600' : gainPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {isBuy ? `${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(2)}%` : '—'}
                      </td>
                    )}
                    <td className={TD2}>
                      <button onClick={() => handleDelete(realIdx)} className="text-slate-500 hover:text-red-400"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={4 + visibleCols.length} className="px-4 py-10 text-center text-sm text-slate-500">No transactions</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <AddTxnModal
          initial={{ ...blank_form, exchange: holding.exchange, ticker: holding.ticker, name: holding.name }}
          title={`Add Transaction — ${holding.ticker}`}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}

export default function Holdings() {
  const { data: cashAccounts = [] } = useCashAccounts()
  const { data: superHoldings = [] } = useSuperHoldings()
  const { data: portfolio = [] } = usePortfolio()
  const { data: snapshots = [] } = useSnapshots()
  const { data: bd } = useBreakdown()

  const saveCash = useSaveCashAccounts()
  const saveSuper = useSaveSuperHoldings()
  const addSnapshot = useAddSnapshot()

  const [showCash, setShowCash] = useState(false)
  const [showSuper, setShowSuper] = useState(false)
  const [historyType, setHistoryType] = useState<'cash' | 'super' | null>(null)
  const [selectedHolding, setSelectedHolding] = useState<Holding | null>(null)
  const [showAddTxn, setShowAddTxn] = useState(false)

  const updateCashField = (idx: number, field: keyof CashAccount, value: string | number) => {
    const updated = cashAccounts.map((a, i) =>
      i === idx ? { ...a, [field]: field === 'balance' ? parseFloat(value as string) || 0 : value } : a
    )
    saveCash.mutate(updated, { onSuccess: () => autoSnapshot(updated) })
  }

  const addCash = () => {
    saveCash.mutate([...cashAccounts, { institution: '', type: '', name: 'New Account', balance: 0, country: 'AU' }])
  }

  const deleteCash = (idx: number) => {
    if (!confirm('Delete this account?')) return
    saveCash.mutate(cashAccounts.filter((_, i) => i !== idx))
  }

  const updateSuperField = (idx: number, field: keyof SuperHolding, value: string | number) => {
    const updated = superHoldings.map((h, i) =>
      i === idx ? { ...h, [field]: field === 'allocation_pct' ? parseFloat(value as string) || 0 : value } : h
    )
    saveSuper.mutate(updated)
  }

  const addSuper = () => {
    saveSuper.mutate([...superHoldings, { name: 'New Fund', class: '', allocation_pct: 0, country: 'AU' }])
  }

  const deleteSuper = (idx: number) => {
    if (!confirm('Delete this holding?')) return
    saveSuper.mutate(superHoldings.filter((_, i) => i !== idx))
  }

  const autoSnapshot = (accounts: CashAccount[]) => {
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    if (snapshots.some(s => s.date === monthStart)) return
    const cashTotal = accounts.reduce((s, a) => s + a.balance, 0)
    const lastSuper = [...snapshots].sort((a, b) => a.date < b.date ? 1 : -1)[0]?.super ?? 0
    addSnapshot.mutate({ date: monthStart, super: lastSuper, cash: cashTotal })
  }

  const activeHoldings = portfolio.filter(h => h.units > 0)

  return (
    <div className="space-y-6">
      {/* Cash card */}
      <div className={CARD} style={CARD_BG}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <p className="text-xs text-slate-400">Total Cash</p>
            <p className="text-2xl font-bold text-white">{fmtCurrency(bd?.cash ?? 0)}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setHistoryType('cash')} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10">
              <Clock size={16} />
            </button>
            <button onClick={() => setShowCash(s => !s)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10">
              {showCash ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        </div>
        {showCash && (
          <div>
            <table className="w-full">
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr>
                  <th className={TH}>Institution</th><th className={TH}>Type</th>
                  <th className={TH}>Name</th><th className={TH}>Balance</th>
                  <th className={TH}>Country</th><th className={TH}></th>
                </tr>
              </thead>
              <tbody>
                {cashAccounts.map((a, i) => (
                  <tr key={i} className="border-t border-[var(--border)]">
                    {(['institution','type','name'] as const).map(f => (
                      <td key={f} className={TD}>
                        <input defaultValue={a[f]} onBlur={e => updateCashField(i, f, e.target.value)}
                          className="bg-transparent w-full text-slate-300 focus:outline-none focus:text-white" />
                      </td>
                    ))}
                    <td className={TD}>
                      <input type="number" defaultValue={a.balance} onBlur={e => updateCashField(i, 'balance', e.target.value)}
                        className="bg-transparent w-full text-slate-300 focus:outline-none focus:text-white" />
                    </td>
                    <td className={TD}>
                      <input defaultValue={a.country} onBlur={e => updateCashField(i, 'country', e.target.value)}
                        className="bg-transparent w-20 text-slate-300 focus:outline-none focus:text-white" />
                    </td>
                    <td className={TD}>
                      <button onClick={() => deleteCash(i)} className="text-slate-500 hover:text-red-400"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-[var(--border)]">
              <button onClick={addCash} className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300">
                <Plus size={14} /> Add Account
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Super card */}
      <div className={CARD} style={CARD_BG}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div>
            <p className="text-xs text-slate-400">Superannuation</p>
            <p className="text-2xl font-bold text-white">{fmtCurrency(bd?.super ?? 0)}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setHistoryType('super')} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10">
              <Clock size={16} />
            </button>
            <button onClick={() => setShowSuper(s => !s)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10">
              {showSuper ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        </div>
        {showSuper && (
          <div>
            <table className="w-full">
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr>
                  <th className={TH}>Name</th><th className={TH}>Class</th>
                  <th className={TH}>Allocation %</th><th className={TH}>Country</th><th className={TH}></th>
                </tr>
              </thead>
              <tbody>
                {superHoldings.map((h, i) => (
                  <tr key={i} className="border-t border-[var(--border)]">
                    {(['name','class'] as const).map(f => (
                      <td key={f} className={TD}>
                        <input defaultValue={h[f]} onBlur={e => updateSuperField(i, f, e.target.value)}
                          className="bg-transparent w-full text-slate-300 focus:outline-none focus:text-white" />
                      </td>
                    ))}
                    <td className={TD}>
                      <input type="number" defaultValue={h.allocation_pct} onBlur={e => updateSuperField(i, 'allocation_pct', e.target.value)}
                        className="bg-transparent w-20 text-slate-300 focus:outline-none focus:text-white" />
                    </td>
                    <td className={TD}>
                      <input defaultValue={h.country} onBlur={e => updateSuperField(i, 'country', e.target.value)}
                        className="bg-transparent w-20 text-slate-300 focus:outline-none focus:text-white" />
                    </td>
                    <td className={TD}>
                      <button onClick={() => deleteSuper(i)} className="text-slate-500 hover:text-red-400"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-[var(--border)]">
              <button onClick={addSuper} className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300">
                <Plus size={14} /> Add Holding
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Stocks header + Add Transaction */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-400">Stocks & ETFs</h2>
        <button
          onClick={() => setShowAddTxn(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
        >
          <Plus size={14} /> Add Transaction
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {activeHoldings.map(h => (
          <div
            key={h.ticker}
            className={`${CARD} p-4 hover:border-[var(--border-hover)] transition-colors cursor-pointer`}
            style={CARD_BG}
            onClick={() => setSelectedHolding(h)}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {h.logo_url && <img src={h.logo_url} alt="" className="w-6 h-6 rounded" onError={e => (e.currentTarget.style.display = 'none')} />}
                <div>
                  <span className="font-semibold text-white text-sm">{h.ticker}</span>
                  <span className="ml-1 text-xs text-slate-400">{h.exchange}</span>
                </div>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${h.daily_change_pct >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                {h.daily_change_pct >= 0 ? '+' : ''}{h.daily_change_pct?.toFixed(2)}%
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-3 truncate">{h.name}</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><p className="text-slate-500">Value</p><p className="text-white font-medium">{fmtCurrency(h.value_aud)}</p></div>
              <div><p className="text-slate-500">Return</p>
                <p className={`font-medium ${h.return_aud >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {fmtCurrency(h.return_aud)} ({fmtPct(h.return_pct)})
                </p>
              </div>
              <div><p className="text-slate-500">Units</p><p className="text-white font-medium">{h.units}</p></div>
              <div><p className="text-slate-500">Price</p><p className="text-white font-medium">{fmtCurrency(h.current_price_aud, 4)}</p></div>
            </div>
            {h.sector && <p className="text-xs text-slate-500 mt-2 truncate">{h.sector} · {h.industry}</p>}
          </div>
        ))}
      </div>

      <HistorySlideout
        type={historyType}
        snapshots={snapshots as Snapshot[]}
        onClose={() => setHistoryType(null)}
      />

      {selectedHolding && (
        <TickerSlideout holding={selectedHolding} onClose={() => setSelectedHolding(null)} />
      )}

      {showAddTxn && (
        <AddTxnModal
          initial={blank_form}
          title="Add Transaction"
          onClose={() => setShowAddTxn(false)}
        />
      )}
    </div>
  )
}
