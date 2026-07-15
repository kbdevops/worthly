import { useState, useMemo } from 'react'
import { RefreshCw, Plus, Trash2, X } from 'lucide-react'
import {
  useDividends, useSyncDividends, useAddDividend, useUpdateDividendFranking, useDeleteDividend,
} from '../../hooks/useApi'
import { fmtCurrency, fmtDate } from '../../lib/utils'
import type { SyncResult } from '../../types'

const CARD = 'rounded-xl p-5 border border-[var(--border)]'
const CARD_BG = { background: 'var(--bg-card)' }
const TH = 'px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap'
const TD = 'px-4 py-3 text-sm whitespace-nowrap'

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={CARD + ' min-w-0'} style={CARD_BG}>
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className="text-xl sm:text-2xl font-bold text-white truncate" title={value}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

export default function Dividends() {
  const { data: dividends = [] } = useDividends()
  const sync = useSyncDividends()
  const addDividend = useAddDividend()
  const updateFranking = useUpdateDividendFranking()
  const deleteDividend = useDeleteDividend()
  const [lastResults, setLastResults] = useState<SyncResult[] | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10), ticker: '', exchange: 'NASDAQ',
    per_share: '', units: '', franking_pct: '0',
  })

  const totals = useMemo(() => {
    const net = dividends.reduce((s, d) => s + d.net_amount_aud, 0)
    const franking = dividends.reduce((s, d) => s + d.franking_credit_aud, 0)
    return { net, franking, grossedUp: net + franking }
  }, [dividends])

  const handleSync = async () => {
    setLastResults(null)
    const res = await sync.mutateAsync()
    setLastResults(res.results || [])
  }

  const handleAdd = () => {
    if (!form.ticker.trim() || !form.per_share || !form.units) return
    addDividend.mutate({
      date: form.date, ticker: form.ticker.trim().toUpperCase(), exchange: form.exchange,
      per_share: parseFloat(form.per_share), units: parseFloat(form.units),
      franking_pct: parseFloat(form.franking_pct) || 0,
    } as never)
    setShowAdd(false)
    setForm({ date: new Date().toISOString().slice(0, 10), ticker: '', exchange: 'NASDAQ', per_share: '', units: '', franking_pct: '0' })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={handleSync} disabled={sync.isPending}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
          <RefreshCw size={14} className={sync.isPending ? 'spin' : ''} />
          {sync.isPending ? 'Syncing…' : 'Sync Dividends'}
        </button>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-300 border border-[var(--border)] hover:border-[var(--border-hover)]">
          <Plus size={14} />
          Add Manual Entry
        </button>
      </div>

      <p className="text-xs text-slate-500 max-w-2xl">
        Dividend history is pulled from yfinance and sized by the units you actually held on each ex-dividend date.
        Franking % isn't published anywhere programmatically — fill it in per-payment for ASX holdings (VAS, NDQ, IVV)
        from your distribution statement or Sharesight; US holdings default to 15% treaty withholding automatically.
      </p>

      {lastResults && lastResults.length > 0 && (
        <div className="rounded-xl p-4 border border-[var(--border)]" style={CARD_BG}>
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Last sync</p>
          <div className="flex flex-wrap gap-2">
            {lastResults.map(r => (
              <span key={r.symbol} title={r.message}
                className="px-2.5 py-1 rounded-full text-xs font-medium"
                style={r.ok ? { background: 'rgba(16,185,129,0.1)', color: '#34d399' } : { background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
                {r.symbol}: {r.message}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Net Dividends Received" value={fmtCurrency(totals.net)} sub="After US withholding" />
        <StatCard label="Franking Credits" value={fmtCurrency(totals.franking)} sub="Tax offset, ASX holdings" />
        <StatCard label="Grossed-Up Total" value={fmtCurrency(totals.grossedUp)} sub="Net + franking credits" />
      </div>

      <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={CARD_BG}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ background: 'var(--bg-elevated)' }}>
              <tr>
                <th className={TH}>Date</th><th className={TH}>Symbol</th><th className={TH}>Per Share</th>
                <th className={TH}>Units</th><th className={TH}>Gross (AUD)</th><th className={TH}>Franking %</th>
                <th className={TH}>Franking Credit</th><th className={TH}>Withholding</th><th className={TH}>Net (AUD)</th>
                <th className={TH}></th>
              </tr>
            </thead>
            <tbody>
              {dividends.map(d => (
                <tr key={d.id} className="border-t border-[var(--border)] hover:bg-white/5">
                  <td className={TD + ' text-slate-400'}>{fmtDate(d.date)}</td>
                  <td className={TD + ' font-medium text-white'}>{d.symbol}</td>
                  <td className={TD + ' text-slate-300'}>{d.currency === 'USD' ? 'US$' : '$'}{d.per_share.toFixed(4)}</td>
                  <td className={TD + ' text-slate-300'}>{d.units.toLocaleString()}</td>
                  <td className={TD + ' text-slate-300'}>{fmtCurrency(d.gross_amount_aud)}</td>
                  <td className={TD}>
                    {d.currency === 'USD' ? (
                      <span className="text-slate-600">—</span>
                    ) : (
                      <input type="number" min={0} max={100} defaultValue={d.franking_pct}
                        onBlur={e => {
                          const v = parseFloat(e.target.value)
                          if (!isNaN(v) && v !== d.franking_pct) updateFranking.mutate({ id: d.id, franking_pct: v })
                        }}
                        className="w-16 px-2 py-1 rounded text-xs text-slate-200 focus:outline-none"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
                    )}
                  </td>
                  <td className={TD + ' text-slate-300'}>{fmtCurrency(d.franking_credit_aud)}</td>
                  <td className={TD + ' text-slate-400'}>{d.withholding_tax_pct > 0 ? `${d.withholding_tax_pct}%` : '—'}</td>
                  <td className={TD + ' text-emerald-400 font-medium'}>{fmtCurrency(d.net_amount_aud)}</td>
                  <td className={TD}>
                    <button onClick={() => deleteDividend.mutate(d.id)} className="text-slate-500 hover:text-red-400">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {dividends.length === 0 && (
            <div className="text-center py-12 text-slate-500 text-sm">
              No dividends recorded yet. Click Sync Dividends to fetch history from yfinance.
            </div>
          )}
        </div>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowAdd(false)}>
          <div className="w-full max-w-md rounded-xl p-6 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-200">Add Dividend</p>
              <button onClick={() => setShowAdd(false)} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Date</label>
                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 focus:outline-none" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Ticker</label>
                <input value={form.ticker} onChange={e => setForm({ ...form, ticker: e.target.value })} placeholder="VAS"
                  className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Exchange</label>
                <select value={form.exchange} onChange={e => setForm({ ...form, exchange: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 focus:outline-none" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                  <option value="NASDAQ">NASDAQ</option>
                  <option value="NYSE">NYSE</option>
                  <option value="ASX">ASX</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Per Share</label>
                <input type="number" value={form.per_share} onChange={e => setForm({ ...form, per_share: e.target.value })} placeholder="0.90"
                  className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Units Held</label>
                <input type="number" value={form.units} onChange={e => setForm({ ...form, units: e.target.value })} placeholder="100"
                  className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Franking %</label>
                <input type="number" min={0} max={100} value={form.franking_pct} onChange={e => setForm({ ...form, franking_pct: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 focus:outline-none" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
              </div>
            </div>
            <button onClick={handleAdd}
              className="w-full py-2.5 rounded-lg text-sm font-medium text-white"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
              Add Dividend
            </button>
          </div>
        </div>
      )}
    </div>
  )
}