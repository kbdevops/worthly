import { useState, useMemo, useRef, useEffect } from 'react'
import { Plus, Trash2, ChevronDown, ChevronUp, Clock, X, Search, Columns3, Pencil, Check, Layers, Archive } from 'lucide-react'
import {
  useCashAccounts, useSuperHoldings, usePortfolio, useSnapshots, useBreakdown,
  useSaveCashAccounts, useSaveSuperHoldings, useAddSnapshot,
  useTransactions, useAddTransaction, useUpdateTransaction, useDeleteTransaction,
  useHoldingGroups, useAddHoldingGroup, useUpdateHoldingGroup, useDeleteHoldingGroup,
  useDividends, useSparklines, useClosedPositions,
} from '../../hooks/useApi'
import { fmtCurrency, fmtCurrencySigned, fmtPct, fmtDate } from '../../lib/utils'
import type { CashAccount, SuperHolding, Snapshot, Holding, Transaction } from '../../types'
import HistorySlideout from '../layout/HistorySlideout'
import { LogoBadge } from '../ui/LogoBadge'

const CARD = 'rounded-xl border border-[var(--border)] overflow-hidden'
const CARD_BG = { background: 'var(--bg-card)' }
const TH = 'px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider'
const TD = 'px-4 py-3 text-sm text-slate-300'
const TH2 = 'px-3 py-2.5 text-left text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap'
const TD2 = 'px-3 py-2.5 text-sm whitespace-nowrap'

const EXCHANGES = ['ASX', 'NASDAQ', 'NYSE', 'US']

type ColKey = 'units' | 'price' | 'currency' | 'fx' | 'brokerage' | 'cost' | 'fx_gain' | 'dividends' | 'gain_aud' | 'gain_pct'
const ALL_COLS: { key: ColKey; label: string }[] = [
  { key: 'units',      label: 'Units' },
  { key: 'price',      label: 'Price' },
  { key: 'currency',   label: 'Curr' },
  { key: 'fx',         label: 'FX Rate' },
  { key: 'brokerage',  label: 'Brokerage' },
  { key: 'cost',       label: 'Cost (AUD)' },
  { key: 'fx_gain',    label: 'FX Gain ($)' },
  { key: 'dividends',  label: 'Dividends ($)' },
  { key: 'gain_aud',   label: 'Return ($)' },
  { key: 'gain_pct',   label: 'Return (%)' },
]
const DEFAULT_COLS: ColKey[] = ['units', 'price', 'cost', 'dividends', 'gain_aud', 'gain_pct']

const blank_form = {
  date: new Date().toISOString().slice(0, 10),
  exchange: 'ASX', ticker: '', name: '', action: 'buy',
  units: '', price: '', brokerage: '', exch_rate: '',
}

function AddTxnModal({
  initial, title, editId, onClose,
}: {
  initial: typeof blank_form
  title: string
  editId?: number
  onClose: () => void
}) {
  const addTxn = useAddTransaction()
  const updateTxn = useUpdateTransaction()
  const [form, setForm] = useState(initial)
  const currency = ['NASDAQ', 'NYSE', 'US'].includes(form.exchange) ? 'USD' : 'AUD'
  const isPending = addTxn.isPending || updateTxn.isPending

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      ...form,
      units: parseFloat(form.units),
      price: parseFloat(form.price) || 0,
      brokerage: parseFloat(form.brokerage) || 0,
      exch_rate: form.exch_rate ? parseFloat(form.exch_rate) : undefined,
    }
    if (editId != null) {
      updateTxn.mutate({ id: editId, ...payload }, { onSuccess: onClose })
    } else {
      addTxn.mutate(payload, { onSuccess: onClose })
    }
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
              ...(currency === 'USD'
                ? [{ label: 'FX Rate (AUD→USD, optional)', key: 'exch_rate', type: 'number', placeholder: 'auto if blank' }]
                : []),
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
          {currency === 'USD' && (
            <p className="text-xs text-slate-500 -mt-1">
              Leave FX Rate blank to auto-use the historical AUDUSD rate for this date — enter your broker's actual settlement rate here for exact cost-basis accuracy.
            </p>
          )}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-lg text-sm text-slate-400 border border-[var(--border)] hover:border-[var(--border-hover)]">Cancel</button>
            <button type="submit" disabled={isPending || !form.ticker.trim()}
              className="flex-1 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
              {isPending ? 'Saving…' : editId != null ? 'Save Changes' : 'Add Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Trend line for the holdings table. Coloured by net direction over the window,
 *  via CSS custom properties so it follows the active theme. */
function Sparkline({ series }: { series?: number[] }) {
  if (!series || series.length < 2) return <span className="text-slate-600">—</span>
  const W = 76, H = 24, pad = 2
  const min = Math.min(...series), max = Math.max(...series)
  const span = max - min || 1
  const x = (i: number) => (i / (series.length - 1)) * W
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - pad * 2)
  const d = series.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const up = series[series.length - 1] >= series[0]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"
      style={{ width: W, height: H, display: 'block' }}>
      <path d={d} fill="none" strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{ stroke: up ? 'var(--gain)' : 'var(--loss)' }} />
    </svg>
  )
}

type HoldingSort = 'ticker' | 'daily_change_pct' | 'units' | 'value_aud' | 'return_aud' | 'return_pct'
  | 'income_aud' | 'total_return_aud'

/** Dense, sortable view of every holding — replaces one card per holding, which
 *  repeated the same four labels N times and made two holdings impossible to
 *  compare without scrolling. Cards are still used below the md breakpoint. */
function HoldingsTable({
  holdings, sparklines, onSelect,
}: {
  holdings: Holding[]
  sparklines: Record<string, number[]>
  onSelect: (h: Holding) => void
}) {
  const [sortKey, setSortKey] = useState<HoldingSort>('value_aud')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)

  const total = holdings.reduce((s, h) => s + h.value_aud, 0)

  const sorted = useMemo(() => {
    return [...holdings].sort((a, b) => {
      if (sortKey === 'ticker') return a.ticker.localeCompare(b.ticker) * -sortDir
      return ((a[sortKey] as number) - (b[sortKey] as number)) * sortDir
    })
  }, [holdings, sortKey, sortDir])

  function toggle(k: HoldingSort) {
    if (k === sortKey) setSortDir(d => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(-1) }
  }

  const COLS: { key?: HoldingSort; label: string; align: 'left' | 'right' }[] = [
    { key: 'ticker',           label: 'Holding',  align: 'left'  },
    { key: 'daily_change_pct', label: 'Today',    align: 'right' },
    {                          label: '30 days',  align: 'right' },
    { key: 'units',            label: 'Units',    align: 'right' },
    { key: 'value_aud',        label: 'Value',    align: 'right' },
    {                          label: 'Weight',   align: 'right' },
    { key: 'return_aud',       label: 'Capital',  align: 'right' },
    { key: 'return_pct',       label: 'Capital %', align: 'right' },
    { key: 'income_aud',       label: 'Income',   align: 'right' },
    { key: 'total_return_aud', label: 'Total',    align: 'right' },
  ]

  const cell = 'px-3 py-2.5 text-sm whitespace-nowrap tabular-nums'

  return (
    <div className={CARD} style={CARD_BG}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead style={{ background: 'var(--bg-elevated)' }}>
            <tr>
              {COLS.map(c => {
                const active = c.key && c.key === sortKey
                return (
                  <th key={c.label}
                    onClick={c.key ? () => toggle(c.key!) : undefined}
                    tabIndex={c.key ? 0 : undefined}
                    onKeyDown={c.key ? e => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(c.key!) }
                    } : undefined}
                    className={`px-3 py-2.5 text-xs font-medium uppercase tracking-wider whitespace-nowrap
                      ${c.align === 'left' ? 'text-left' : 'text-right'}
                      ${c.key ? 'cursor-pointer select-none hover:text-white' : ''}
                      ${active ? 'text-white' : 'text-slate-400'}`}
                  >
                    {c.label}
                    {active && (
                      <span className="ml-1 text-[9px]" style={{ color: 'var(--accent)' }}>
                        {sortDir < 0 ? '▼' : '▲'}
                      </span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map(h => {
              const weight = total > 0 ? (h.value_aud / total) * 100 : 0
              return (
                <tr key={h.ticker}
                  onClick={() => onSelect(h)}
                  className="border-t border-[var(--border)] hover:bg-white/5 cursor-pointer"
                >
                  <td className={cell}>
                    <div className="flex items-center gap-2.5">
                      <LogoBadge logoUrl={h.logo_url} ticker={h.ticker} size={26} />
                      <div className="min-w-0">
                        <div className="font-semibold text-white leading-tight">{h.ticker}</div>
                        <div className="text-[10px] text-slate-500 tracking-wide">{h.exchange} · {h.currency}</div>
                      </div>
                    </div>
                  </td>
                  <td className={cell + ' text-right'}>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      h.daily_change_pct >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                      {h.daily_change_pct >= 0 ? '+' : ''}{h.daily_change_pct?.toFixed(2)}%
                    </span>
                  </td>
                  <td className={cell}>
                    <div className="flex justify-end"><Sparkline series={sparklines[h.ticker]} /></div>
                  </td>
                  <td className={cell + ' text-right text-slate-400'}>
                    {h.units.toLocaleString('en-AU', { maximumFractionDigits: 3 })}
                  </td>
                  <td className={cell + ' text-right text-white font-medium'}>{fmtCurrency(h.value_aud)}</td>
                  <td className={cell + ' text-right'}>
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-slate-400">{weight.toFixed(1)}%</span>
                      <span className="w-14 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-elevated)' }}>
                        <span className="block h-full rounded-full"
                          style={{ width: `${weight}%`, background: 'var(--accent)', opacity: 0.8 }} />
                      </span>
                    </div>
                  </td>
                  <td className={cell + ` text-right font-medium ${h.return_aud >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {h.return_aud >= 0 ? '+' : '−'}{fmtCurrency(h.return_aud)}
                  </td>
                  <td className={cell + ` text-right font-medium ${h.return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {fmtPct(h.return_pct)}
                  </td>
                  <td className={cell + ' text-right font-medium ' + (h.income_aud > 0 ? 'text-amber-400' : 'text-slate-600')}>
                    {h.income_aud > 0 ? fmtCurrency(h.income_aud) : '—'}
                    {h.franking_aud > 0 && (
                      <div className="text-[10px] font-normal text-slate-500 leading-tight">
                        +{fmtCurrency(h.franking_aud)} franking
                      </div>
                    )}
                  </td>
                  <td className={cell + ` text-right font-semibold ${h.total_return_aud >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {h.total_return_aud >= 0 ? '+' : '−'}{fmtCurrency(h.total_return_aud)}
                  </td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLS.length} className="px-4 py-10 text-center text-sm text-slate-500">
                  No holdings yet — add a transaction to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TickerSlideout({ holding, onClose }: { holding: Holding; onClose: () => void }) {
  const { data: txns = [] } = useTransactions()
  const { data: divs = [] } = useDividends()
  const deleteTxn = useDeleteTransaction()

  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null)
  const [cols, setCols] = useState<ColKey[]>(DEFAULT_COLS)
  const [showColPicker, setShowColPicker] = useState(false)
  const colPickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showColPicker) return
    function handleClickOutside(e: MouseEvent) {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setShowColPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showColPicker])

  const tickerTxns = useMemo(() =>
    txns.filter(t => t.ticker === holding.ticker && t.exchange === holding.exchange),
    [txns, holding.ticker, holding.exchange]
  )

  const tickerDivs = useMemo(() =>
    divs.filter(d => d.ticker === holding.ticker && d.exchange === holding.exchange),
    [divs, holding.ticker, holding.exchange]
  )

  // Attribute each dividend payment back to the buy lot(s) that were held on its ex-date,
  // split proportionally by units — `d.units` is already the total units held then, so a
  // lot bought before the ex-date gets its share via (lot units / units held that day).
  // Lots bought after the ex-date get none.
  function dividendsForTxn(t: Transaction): number {
    if (t.action !== 'buy') return 0
    return tickerDivs.reduce((sum, d) => {
      if (d.date < t.date || !d.units) return sum
      return sum + d.net_amount_aud * (t.units / d.units)
    }, 0)
  }

  const filtered = useMemo(() =>
    tickerTxns
      .filter(t => !search || t.action.includes(search.toLowerCase()) || t.date.includes(search))
      .sort((a, b) => b.date.localeCompare(a.date)),
    [tickerTxns, search]
  )

  function toggleCol(key: ColKey) {
    setCols(c => c.includes(key) ? c.filter(k => k !== key) : [...c, key])
  }

  function handleDeleteTxn(id: number) {
    if (!confirm('Delete this transaction?')) return
    deleteTxn.mutate(id)
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
            <LogoBadge logoUrl={holding.logo_url} ticker={holding.ticker} size={32} />
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
          <div className="relative" ref={colPickerRef}>
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
                const capitalGain = t.gain_aud ?? 0
                const fxGain = t.fx_gain_aud ?? 0
                const isBuy = t.action === 'buy'
                const cost = Math.abs(t.value)
                const dividendsAud = dividendsForTxn(t)
                const totalGain = capitalGain + dividendsAud
                const totalGainPct = cost > 0 ? (totalGain / cost) * 100 : 0
                return (
                  <tr key={t.id ?? i} className="border-t border-[var(--border)] hover:bg-white/5">
                    <td className={TD2 + ' text-slate-400'}>{fmtDate(t.date)}</td>
                    <td className={TD2}>
                      <div className="flex items-center gap-1.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.action === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : t.action === 'sell' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                          {t.action}
                        </span>
                        {t.source === 'ibkr' && (
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-indigo-500/20 text-indigo-300" title="Imported from Interactive Brokers">
                            IBKR
                          </span>
                        )}
                      </div>
                    </td>
                    {cols.includes('units')     && <td className={TD2 + ' text-slate-300'}>{t.units}</td>}
                    {cols.includes('price')     && <td className={TD2 + ' text-slate-300'}>{t.price}</td>}
                    {cols.includes('currency')  && <td className={TD2 + ' text-slate-500'}>{t.currency}</td>}
                    {cols.includes('fx')        && <td className={TD2 + ' text-slate-500'}>{t.exch_rate}</td>}
                    {cols.includes('brokerage') && <td className={TD2 + ' text-slate-500'}>{t.brokerage}</td>}
                    {cols.includes('cost')      && <td className={TD2 + ' text-white font-medium'}>{fmtCurrency(cost)}</td>}
                    {cols.includes('fx_gain')   && (
                      <td className={TD2 + ' font-medium ' + (!isBuy || t.currency !== 'USD' ? 'text-slate-600' : fxGain >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {isBuy && t.currency === 'USD' ? `${fxGain >= 0 ? '+' : ''}${fmtCurrency(fxGain)}` : '—'}
                      </td>
                    )}
                    {cols.includes('dividends') && (
                      <td className={TD2 + ' font-medium ' + (isBuy && dividendsAud > 0 ? 'text-amber-400' : 'text-slate-600')}>
                        {isBuy && dividendsAud > 0 ? fmtCurrency(dividendsAud) : '—'}
                      </td>
                    )}
                    {cols.includes('gain_aud')  && (
                      <td className={TD2 + ' font-medium ' + (!isBuy ? 'text-slate-600' : totalGain >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {isBuy ? `${totalGain >= 0 ? '+' : ''}${fmtCurrency(totalGain)}` : '—'}
                      </td>
                    )}
                    {cols.includes('gain_pct')  && (
                      <td className={TD2 + ' font-medium ' + (!isBuy ? 'text-slate-600' : totalGainPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {isBuy ? `${totalGainPct >= 0 ? '+' : ''}${totalGainPct.toFixed(2)}%` : '—'}
                      </td>
                    )}
                    <td className={TD2}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setEditingTxn(t)} className="text-slate-500 hover:text-white"><Pencil size={13} /></button>
                        <button onClick={() => t.id != null && handleDeleteTxn(t.id)} className="text-slate-500 hover:text-red-400"><Trash2 size={13} /></button>
                      </div>
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

      {editingTxn && (
        <AddTxnModal
          initial={{
            date: editingTxn.date,
            exchange: editingTxn.exchange,
            ticker: editingTxn.ticker,
            name: editingTxn.name,
            action: editingTxn.action,
            units: String(editingTxn.units),
            price: String(editingTxn.price),
            brokerage: String(editingTxn.brokerage),
            exch_rate: editingTxn.exch_rate ? String(editingTxn.exch_rate) : '',
          }}
          title={`Edit Transaction — ${editingTxn.ticker}`}
          editId={editingTxn.id}
          onClose={() => setEditingTxn(null)}
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
  const { data: groupsData } = useHoldingGroups()
  const { data: sparklines = {} } = useSparklines()

  const saveCash = useSaveCashAccounts()
  const saveSuper = useSaveSuperHoldings()
  const addSnapshot = useAddSnapshot()
  const addGroup = useAddHoldingGroup()
  const updateGroup = useUpdateHoldingGroup()
  const deleteGroup = useDeleteHoldingGroup()

  const [showCash, setShowCash] = useState(false)
  const [showSuper, setShowSuper] = useState(false)
  const [showGroups, setShowGroups] = useState(true)
  const [showClosed, setShowClosed] = useState(true)
  const { data: closed } = useClosedPositions()
  const [editingSuperBalance, setEditingSuperBalance] = useState(false)
  const [superBalanceInput, setSuperBalanceInput] = useState('')
  const [historyType, setHistoryType] = useState<'cash' | 'super' | null>(null)
  const [selectedHolding, setSelectedHolding] = useState<Holding | null>(null)
  const [showAddTxn, setShowAddTxn] = useState(false)
  const [groupModal, setGroupModal] = useState<{ id: number | null; name: string; symbols: string[] } | null>(null)

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

  const startEditSuperBalance = () => {
    setSuperBalanceInput(String(bd?.super ?? 0))
    setEditingSuperBalance(true)
  }

  const confirmEditSuperBalance = () => {
    const newSuper = parseFloat(superBalanceInput)
    if (isNaN(newSuper)) { setEditingSuperBalance(false); return }
    const today = new Date().toISOString().slice(0, 10)
    const cashTotal = cashAccounts.reduce((s, a) => s + a.balance, 0)
    addSnapshot.mutate({ date: today, super: newSuper, cash: cashTotal })
    setEditingSuperBalance(false)
  }

  const activeHoldings = portfolio.filter(h => h.units > 0)

  const openAddGroup = () => setGroupModal({ id: null, name: '', symbols: [] })
  const openEditGroup = (g: { id: number; name: string; symbols: string[] }) =>
    setGroupModal({ id: g.id, name: g.name, symbols: g.symbols })

  const toggleGroupSymbol = (symbol: string) => {
    if (!groupModal) return
    setGroupModal({
      ...groupModal,
      symbols: groupModal.symbols.includes(symbol)
        ? groupModal.symbols.filter(s => s !== symbol)
        : [...groupModal.symbols, symbol],
    })
  }

  const saveGroup = () => {
    if (!groupModal || !groupModal.name.trim() || groupModal.symbols.length === 0) return
    if (groupModal.id) {
      updateGroup.mutate({ id: groupModal.id, name: groupModal.name.trim(), symbols: groupModal.symbols })
    } else {
      addGroup.mutate({ name: groupModal.name.trim(), symbols: groupModal.symbols })
    }
    setGroupModal(null)
  }

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
            {editingSuperBalance ? (
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="number"
                  autoFocus
                  value={superBalanceInput}
                  onChange={e => setSuperBalanceInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') confirmEditSuperBalance(); if (e.key === 'Escape') setEditingSuperBalance(false) }}
                  className="text-2xl font-bold text-white bg-transparent border-b border-[var(--accent)] focus:outline-none w-40"
                />
                <button onClick={confirmEditSuperBalance} className="p-1.5 rounded-lg text-emerald-400 hover:bg-white/10">
                  <Check size={16} />
                </button>
                <button onClick={() => setEditingSuperBalance(false)} className="p-1.5 rounded-lg text-slate-500 hover:bg-white/10">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold text-white">{fmtCurrency(bd?.super ?? 0)}</p>
                <button onClick={startEditSuperBalance} title="Update super balance" className="p-1 rounded text-slate-500 hover:text-white hover:bg-white/10">
                  <Pencil size={13} />
                </button>
              </div>
            )}
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
        <p className="px-5 pt-3 text-xs text-slate-500">
          The table below is your allocation breakdown (asset class %), not your balance — use the pencil above to update the actual dollar total.
        </p>
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

      {/* Closed positions — sold to zero, so absent from the holdings table above.
          Without this, exiting a position erases it from every screen: selling out of
          VAS hid a 60-trade five-year holding worth $50,056.86 realised and $28,999.22
          in dividends, even though that money still counts in the portfolio totals. */}
      {closed && closed.positions.length > 0 && (
        <div className={CARD} style={CARD_BG}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              <Archive size={16} className="text-slate-400" />
              <p className="text-sm font-medium text-slate-200">
                Closed Positions
                <span className="ml-2 text-xs text-slate-500">
                  {closed.positions.length} exited · realised {fmtCurrencySigned(closed.total_realised)}
                  {closed.total_income > 0 && ` · income ${fmtCurrency(closed.total_income)}`}
                </span>
              </p>
            </div>
            <button onClick={() => setShowClosed(v => !v)} className="text-slate-500 hover:text-white">
              {showClosed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
          {showClosed && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead style={{ background: 'var(--bg-elevated)' }}>
                  <tr>
                    <th className={TH2}>Holding</th>
                    <th className={TH2}>Closed</th>
                    <th className={TH2}>Held</th>
                    <th className={TH2}>Invested</th>
                    <th className={TH2}>Proceeds</th>
                    <th className={TH2}>Realised</th>
                    <th className={TH2}>Income</th>
                    <th className={TH2}>Total</th>
                    <th className={TH2}>Return</th>
                  </tr>
                </thead>
                <tbody>
                  {closed.positions.map(p => (
                    <tr key={p.ticker} className="border-t border-[var(--border)] hover:bg-white/5">
                      <td className={TD2}>
                        <span className="font-semibold text-white">{p.ticker}</span>
                        <span className="block text-[10px] text-slate-500">
                          {p.exchange} · {p.buys_count} buys / {p.sells_count} sells
                        </span>
                      </td>
                      <td className={TD2 + ' text-slate-400'}>{fmtDate(p.closed_date)}</td>
                      <td className={TD2 + ' text-slate-500'}>
                        {p.held_days >= 365 ? `${(p.held_days / 365).toFixed(1)}y` : `${p.held_days}d`}
                      </td>
                      <td className={TD2 + ' text-slate-300'}>{fmtCurrency(p.invested)}</td>
                      <td className={TD2 + ' text-slate-300'}>{fmtCurrency(p.proceeds)}</td>
                      <td className={TD2 + ' font-medium ' + (p.realised_aud >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {fmtCurrencySigned(p.realised_aud)}
                      </td>
                      <td className={TD2 + (p.income_aud > 0 ? ' text-amber-400' : ' text-slate-600')}>
                        {p.income_aud > 0 ? fmtCurrency(p.income_aud) : '—'}
                      </td>
                      <td className={TD2 + ' font-semibold ' + (p.total_return_aud >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {fmtCurrencySigned(p.total_return_aud)}
                      </td>
                      <td className={TD2 + ' font-medium ' + ((p.return_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {p.return_pct != null ? fmtPct(p.return_pct) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-5 py-3 text-[11px] text-slate-500">
                Return % is realised gain over total invested, average-cost basis. Income is
                lifetime dividends received while the position was held. These figures are
                already included in the portfolio's realised gain and total return.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Holding Groups — Sharesight-style custom groupings with Value/Capital Gain/Income/Currency/Return + grand total */}
      <div className={CARD} style={CARD_BG}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-slate-400" />
            <p className="text-sm font-medium text-slate-200">Holding Groups</p>
          </div>
          <div className="flex gap-2">
            <button onClick={openAddGroup} className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 px-2">
              <Plus size={14} /> New Group
            </button>
            <button onClick={() => setShowGroups(s => !s)} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10">
              {showGroups ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          </div>
        </div>
        {showGroups && (
          groupsData && groupsData.groups.length > 0 ? (
            <table className="w-full">
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr>
                  <th className={TH2}>Group</th>
                  <th className={TH2}>Value</th>
                  <th className={TH2}>Capital Gain</th>
                  <th className={TH2}>Income</th>
                  <th className={TH2}>Currency</th>
                  <th className={TH2}>Capital %</th>
                  <th className={TH2}></th>
                </tr>
              </thead>
              <tbody>
                {groupsData.groups.map(g => (
                  <tr key={g.id} className="border-t border-[var(--border)] hover:bg-white/5">
                    <td className={TD2}>
                      <button onClick={() => openEditGroup(g)} className="text-white font-medium hover:text-indigo-400 text-left">
                        {g.name}
                      </button>
                      <span className="block text-xs text-slate-500">{g.symbols.length} holding{g.symbols.length !== 1 ? 's' : ''}</span>
                    </td>
                    <td className={TD2 + ' text-slate-200'}>{fmtCurrency(g.value)}</td>
                    <td className={TD2}>
                      <span className={g.capital_gain >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmtCurrencySigned(g.capital_gain)}</span>
                    </td>
                    <td className={TD2 + ' text-slate-200'}>{fmtCurrency(g.income)}</td>
                    <td className={TD2 + ' text-slate-400'}>{g.currency}</td>
                    <td className={TD2}>
                      <span className={g.return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmtPct(g.return_pct)}</span>
                    </td>
                    <td className={TD2}>
                      <button onClick={() => deleteGroup.mutate(g.id)} className="text-slate-500 hover:text-red-400"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--border)]" style={{ background: 'var(--bg-elevated)' }}>
                  <td className={TD2 + ' font-semibold text-white'}>Grand Total</td>
                  <td className={TD2 + ' font-semibold text-white'}>{fmtCurrency(groupsData.grand_total.value)}</td>
                  <td className={TD2 + ' font-semibold'}>
                    <span className={groupsData.grand_total.capital_gain >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {fmtCurrencySigned(groupsData.grand_total.capital_gain)}
                    </span>
                  </td>
                  <td className={TD2 + ' font-semibold text-white'}>{fmtCurrency(groupsData.grand_total.income)}</td>
                  <td className={TD2 + ' text-slate-400'}>{groupsData.grand_total.currency}</td>
                  <td className={TD2 + ' font-semibold'}>
                    <span className={groupsData.grand_total.return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      {fmtPct(groupsData.grand_total.return_pct)}
                    </span>
                  </td>
                  <td className={TD2}></td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <div className="text-center py-8 text-slate-500 text-sm">
              No groups yet — group holdings together (e.g. "US Tech", "ASX ETFs") to see combined value, gain, income and return.
            </div>
          )
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

      {/* Dense sortable table on desktop; the card layout below is kept for narrow
          screens, where a wide table genuinely doesn't work. */}
      <div className="hidden md:block">
        <HoldingsTable
          holdings={activeHoldings}
          sparklines={sparklines}
          onSelect={setSelectedHolding}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:hidden">
        {activeHoldings.map(h => (
          <div
            key={h.ticker}
            className={`${CARD} p-4 hover:border-[var(--border-hover)] transition-colors cursor-pointer`}
            style={CARD_BG}
            onClick={() => setSelectedHolding(h)}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <LogoBadge logoUrl={h.logo_url} ticker={h.ticker} size={24} />
                <div>
                  <span className="font-semibold text-white text-sm">{h.ticker}</span>
                  <span className="ml-1 text-xs text-slate-400">{h.exchange}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {h.last_synced && (() => {
                  const mins = Math.floor((Date.now() - new Date(h.last_synced).getTime()) / 60000)
                  const label = mins < 1 ? 'live' : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`
                  const stale = mins > 120
                  return (
                    <span className="text-[10px]" style={{ color: stale ? '#f59e0b' : '#475569' }} title={`Last synced: ${h.last_synced}`}>
                      {stale ? '⚠ ' : ''}{label}
                    </span>
                  )
                })()}
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${h.daily_change_pct >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                  {h.daily_change_pct >= 0 ? '+' : ''}{h.daily_change_pct?.toFixed(2)}%
                </span>
              </div>
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

      {groupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setGroupModal(null)}>
          <div className="w-full max-w-md rounded-xl p-6 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-200">{groupModal.id ? 'Edit Group' : 'New Group'}</p>
              <button onClick={() => setGroupModal(null)} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Group Name</label>
              <input
                value={groupModal.name}
                onChange={e => setGroupModal({ ...groupModal, name: e.target.value })}
                placeholder="e.g. US Tech, ASX ETFs"
                className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Holdings</label>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border)]" style={{ background: 'var(--bg-elevated)' }}>
                {activeHoldings.map(h => (
                  <label key={h.symbol} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-white/5 border-b border-[var(--border)] last:border-b-0">
                    <input
                      type="checkbox"
                      checked={groupModal.symbols.includes(h.symbol)}
                      onChange={() => toggleGroupSymbol(h.symbol)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="text-sm text-slate-300">{h.ticker}</span>
                    <span className="text-xs text-slate-500">{h.exchange}</span>
                  </label>
                ))}
                {activeHoldings.length === 0 && (
                  <p className="px-3 py-4 text-xs text-slate-500 text-center">No active holdings to group yet.</p>
                )}
              </div>
            </div>
            <button
              onClick={saveGroup}
              disabled={!groupModal.name.trim() || groupModal.symbols.length === 0}
              className="w-full py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
            >
              {groupModal.id ? 'Save Changes' : 'Create Group'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}