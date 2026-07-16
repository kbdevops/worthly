import { useState } from 'react'
import { useCGT } from '../../hooks/useApi'
import { fmtCurrency, fmtDate } from '../../lib/utils'

const FY_OPTIONS = [
  { label: 'FY 2027', from: '2026-07-01', to: '2027-06-30' },
  { label: 'FY 2026', from: '2025-07-01', to: '2026-06-30' },
  { label: 'FY 2025', from: '2024-07-01', to: '2025-06-30' },
  { label: 'FY 2024', from: '2023-07-01', to: '2024-06-30' },
  { label: 'FY 2023', from: '2022-07-01', to: '2023-06-30' },
  { label: 'FY 2022', from: '2021-07-01', to: '2022-06-30' },
  { label: 'Custom', from: '', to: '' },
]

const TH = 'px-3 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap'
const TD = 'px-3 py-3 text-sm whitespace-nowrap'

const METHODS: { key: 'fifo' | 'lifo' | 'hifo'; label: string; hint: string }[] = [
  { key: 'fifo', label: 'FIFO', hint: 'Oldest parcels sold first — the ATO default unless you specifically identify otherwise' },
  { key: 'lifo', label: 'LIFO', hint: 'Newest parcels sold first' },
  { key: 'hifo', label: 'HIFO', hint: 'Highest-cost parcels sold first — minimizes reported gain' },
]

export default function Tax() {
  const [fyIdx, setFyIdx] = useState(1)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [method, setMethod] = useState<'fifo' | 'lifo' | 'hifo'>('fifo')

  const selected = FY_OPTIONS[fyIdx]
  const isCustom = selected.label === 'Custom'
  const from = isCustom ? customFrom : selected.from
  const to = isCustom ? customTo : selected.to
  const enabled = !!(from && to)

  const { data: cgt, isLoading } = useCGT(from, to, method, enabled)

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Financial Year</label>
          <select value={fyIdx} onChange={e => setFyIdx(Number(e.target.value))}
            className="py-2 px-3 rounded-lg text-sm bg-[var(--bg-card)] border border-[var(--border)] text-slate-300 focus:outline-none focus:border-indigo-500">
            {FY_OPTIONS.map((f, i) => <option key={f.label} value={i}>{f.label}</option>)}
          </select>
        </div>
        {isCustom && (
          <>
            <div>
              <label className="block text-xs text-slate-400 mb-1">From</label>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="py-2 px-3 rounded-lg text-sm bg-[var(--bg-card)] border border-[var(--border)] text-slate-300 focus:outline-none focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">To</label>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="py-2 px-3 rounded-lg text-sm bg-[var(--bg-card)] border border-[var(--border)] text-slate-300 focus:outline-none focus:border-indigo-500" />
            </div>
          </>
        )}
        <div>
          <label className="block text-xs text-slate-400 mb-1">Parcel Method</label>
          <div className="flex rounded-lg overflow-hidden border border-[var(--border)]">
            {METHODS.map(m => (
              <button
                key={m.key}
                title={m.hint}
                onClick={() => setMethod(m.key)}
                className="px-3 py-2 text-xs font-medium transition-all"
                style={method === m.key
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { background: 'var(--bg-card)', color: '#94a3b8' }}
              >{m.label}</button>
            ))}
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-500 -mt-3">{METHODS.find(m => m.key === method)?.hint}</p>

      {/* Summary cards */}
      {cgt && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            { label: 'Total Gains', value: fmtCurrency(cgt.total_gain), color: '#10b981' },
            { label: 'Losses Applied', value: fmtCurrency(cgt.losses_applied), color: '#ef4444' },
            { label: '50% Discount', value: fmtCurrency(cgt.cgt_discount), color: 'var(--accent)' },
            { label: 'Net Capital Gain', value: fmtCurrency(cgt.net_gain), color: cgt.net_gain >= 0 ? '#10b981' : '#ef4444' },
          ].map(c => (
            <div key={c.label} className="rounded-xl p-5 border border-[var(--border)]" style={{ background: 'var(--bg-card)' }}>
              <p className="text-xs text-slate-400 mb-1">{c.label}</p>
              <p className="text-2xl font-bold" style={{ color: c.color }}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {isLoading && <p className="text-slate-400 text-sm">Calculating…</p>}
      {cgt && (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-card)' }}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr>
                  <th className={TH}>Sold</th><th className={TH}>Acquired</th><th className={TH}>Ticker</th><th className={TH}>Name</th>
                  <th className={TH}>Units</th><th className={TH}>Proceeds</th><th className={TH}>Cost</th>
                  <th className={TH}>Gain/Loss</th><th className={TH}>Discounted</th>
                </tr>
              </thead>
              <tbody>
                {cgt.gains.map((d, i) => (
                  <tr key={i} className="border-t border-[var(--border)] hover:bg-white/5">
                    <td className={TD + ' text-slate-400'}>{fmtDate(d.date)}</td>
                    <td className={TD + ' text-slate-500'}>{fmtDate(d.acquired_date)}</td>
                    <td className={TD + ' font-medium text-white'}>{d.ticker}</td>
                    <td className={TD + ' text-slate-300'}>{d.name}</td>
                    <td className={TD + ' text-slate-300'}>{d.units}</td>
                    <td className={TD + ' text-slate-300'}>{fmtCurrency(d.proceeds)}</td>
                    <td className={TD + ' text-slate-300'}>{fmtCurrency(d.cost)}</td>
                    <td className={TD + (d.gain >= 0 ? ' text-emerald-400' : ' text-red-400')}>
                      {d.gain >= 0 ? '+' : ''}{fmtCurrency(d.gain)}
                    </td>
                    <td className={TD}>
                      {d.discount_eligible && (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-500/20 text-indigo-400">50% off</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cgt.gains.length === 0 && (
              <div className="text-center py-12 text-slate-500 text-sm">No disposals in this period</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}