import { useState, useMemo } from 'react'
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid, LabelList,
} from 'recharts'
import { useCompounder } from '../../hooks/useApi'
import type { CompounterFYRow } from '../../types'
import CompoundCalculator from '../CompoundCalculator'

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null) return '—'
  return n.toLocaleString('en-AU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${fmt(abs / 1_000_000, 2)}M`
  if (abs >= 1_000) return `${sign}$${fmt(abs / 1_000, 1)}k`
  return `${sign}$${fmt(abs, 0)}`
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function pctColor(n: number | null | undefined): string {
  if (n == null) return ''
  return n >= 0 ? 'text-emerald-400' : 'text-red-400'
}

function SummaryCard({ label, value, sub, accent }: {
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className={`text-2xl font-bold ${accent ?? ''}`} style={{ color: accent ? undefined : 'var(--text-primary)' }}>
        {value}
      </div>
      {sub && <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  )
}

function fmtMonthLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
}


function FYReturnsChart({ fyRows }: { fyRows: CompounterFYRow[] }) {
  if (fyRows.length === 0) return null

  // Only bars with actual growth % — first year has no prior NW so can't compute
  const chartRows = fyRows.filter(r => r.growth_pct != null)
  const lastIdx = chartRows.length - 1

  const data = chartRows.map((r, i) => ({
    label: i === lastIdx ? `${r.fy}*` : r.fy,
    pct: r.growth_pct as number,
    isCurrent: i === lastIdx,
  }))

  const maxPct = Math.max(...data.map(d => d.pct), 10)
  const minPct = Math.min(...data.map(d => d.pct), 0)
  const baseYear = fyRows.find(r => r.growth_pct == null)

  return (
    <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Annual Returns</span>
        {baseYear && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            · {baseYear.fy} is the base year (no prior data)
          </span>
        )}
      </div>
      <div className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Growth % per financial year · * current FY (YTD)
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 32, right: 16, bottom: 0, left: 8 }} barCategoryGap="35%">
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12, fill: '#e2e8f0', fontWeight: 500 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[Math.min(minPct - 5, 0), maxPct + 15]}
            tick={{ fontSize: 10, fill: '#e2e8f0' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => `${v}%`}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: '#0f172a',
              border: '1px solid #1e293b',
              borderRadius: '0.5rem',
              fontSize: '12px',
            }}
            labelStyle={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 2 }}
            itemStyle={{ color: '#e2e8f0' }}
            formatter={(v, _n, entry) => {
              // Recharts types the value as ValueType | undefined, so narrow it here.
              const n = Number(v ?? 0)
              const isCurrent = (entry as { payload?: { isCurrent?: boolean } })?.payload?.isCurrent
              return [`${n >= 0 ? '+' : ''}${n.toFixed(2)}%`, isCurrent ? 'YTD' : 'Growth']
            }}
            cursor={false}
          />
          <ReferenceLine y={0} stroke="#1e293b" strokeWidth={1} />
          <Bar dataKey="pct" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={80} minPointSize={14}>
            <LabelList
              dataKey="pct"
              content={props => {
                // Recharts widens x/y/width to string | number | undefined.
                const { x, y, width, value } = props as {
                  x?: string | number; y?: string | number
                  width?: string | number; value?: string | number
                }
                if (value == null) return null
                const n = Number(value)
                if (Number.isNaN(n)) return null
                return (
                  <text
                    x={Number(x ?? 0) + Number(width ?? 0) / 2}
                    y={Number(y ?? 0) - 8}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={700}
                    fill="#e2e8f0"
                  >
                    {`${n >= 0 ? '+' : ''}${n.toFixed(1)}%`}
                  </text>
                )
              }}
            />
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.pct >= 0 ? '#34d399' : '#f87171'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Shortest span worth annualising. Slightly under 1 so a 365-day year (0.9993
 *  against a 365.25-day year) still counts as a full year. */
const MIN_ANNUALISE_YEARS = 0.99

function fyBoundsForRow(row: CompounterFYRow, monthly: { date: string; nw: number }[]) {
  const fyEndYear = parseInt(row.fy.replace('FY', ''))
  // The July points ARE the boundaries: 1 Jul 2025 opens FY2026 and 1 Jul 2026 closes
  // it. Anchoring to them keeps this in step with the FY Annual Snapshots table, which
  // measures "Prior NW" → "NW End" across exactly that window.
  //
  // This used to open on the prior June instead, to avoid an 11-month span — the right
  // patch at the time, because the table it had to agree with also closed a month early.
  // Both now run July to July, so the span is a clean 12 months from the correct end.
  const julyIdx = (year: number) => monthly.findIndex(m => {
    const d = new Date(m.date + 'T00:00:00')
    return d.getMonth() + 1 === 7 && d.getFullYear() === year
  })
  const openIdx = julyIdx(fyEndYear - 1)
  const closeIdx = julyIdx(fyEndYear)
  return {
    // History beginning mid-FY has no opening boundary — fall back to the first point,
    // which then honestly reports as a partial year.
    firstIdx: openIdx >= 0 ? openIdx : 0,
    // No closing boundary means the year is still running: close on the latest point.
    lastIdx: closeIdx >= 0 ? closeIdx : monthly.length - 1,
  }
}

function CAGRCalculator({
  monthly,
  fyRows,
}: {
  monthly: { date: string; nw: number }[]
  fyRows: CompounterFYRow[]
}) {
  // Default to all-time (first → last)
  const [startIdx, setStartIdx] = useState(0)
  const [endIdx, setEndIdx] = useState(monthly.length > 0 ? monthly.length - 1 : 0)
  const [activePreset, setActivePreset] = useState<string>('all')

  const applyPreset = (preset: string) => {
    setActivePreset(preset)
    if (preset === 'all') {
      setStartIdx(0)
      setEndIdx(monthly.length - 1)
      return
    }
    const row = fyRows.find(r => r.fy === preset)
    if (!row) return
    const { firstIdx, lastIdx } = fyBoundsForRow(row, monthly)
    setStartIdx(firstIdx)
    setEndIdx(lastIdx)
  }

  const handleManualChange = (which: 'start' | 'end', idx: number) => {
    setActivePreset('custom')
    if (which === 'start') setStartIdx(idx)
    else setEndIdx(idx)
  }

  const startPoint = monthly[startIdx]
  const endPoint = monthly[endIdx]

  const { years, cagr, totalPct } = useMemo(() => {
    const none = { years: 0, cagr: null, totalPct: null }
    if (!startPoint || !endPoint || startPoint.nw <= 0 || startPoint.date === endPoint.date)
      return none
    const d1 = new Date(startPoint.date + 'T00:00:00')
    const d2 = new Date(endPoint.date + 'T00:00:00')
    const y = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
    if (y <= 0) return none
    const pct = (endPoint.nw / startPoint.nw - 1) * 100
    // Only annualise a full year or more. Raising a short-period return to the
    // power of 1/y explodes as y approaches zero — a 3.1% move over two days
    // annualises to ~25,000%, which is arithmetically true and completely
    // meaningless. Under a year we report the plain cumulative return instead.
    // The tolerance is because a 365-day year is 0.9993 against 365.25, and a
    // full FY must not report as "too short to annualise".
    if (y < MIN_ANNUALISE_YEARS) return { years: y, cagr: null, totalPct: pct }
    return { years: y, cagr: (Math.pow(endPoint.nw / startPoint.nw, 1 / y) - 1) * 100, totalPct: pct }
  }, [startPoint, endPoint])

  const shown = cagr ?? totalPct
  const months = Math.max(1, Math.round(years * 12))
  const periodLabel = years >= MIN_ANNUALISE_YEARS
    ? `over ${years.toFixed(1)} yrs`
    : `over ${months} month${months === 1 ? '' : 's'} — too short to annualise`

  const presets = [
    { key: 'all', label: 'All time' },
    ...fyRows.map(r => ({ key: r.fy, label: r.fy })),
  ]

  return (
    <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
        CAGR Calculator
      </div>

      {/* Preset pills */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {presets.map(p => (
          <button
            key={p.key}
            onClick={() => applyPreset(p.key)}
            className="text-xs px-3 py-1 rounded-full font-medium transition-all"
            style={activePreset === p.key ? {
              background: 'var(--accent)',
              color: '#fff',
              border: '1px solid transparent',
            } : {
              background: 'var(--bg-base)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Month selectors */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {([['From', startIdx, 'start'], ['To', endIdx, 'end']] as const).map(([label, idx, which]) => {
          const pt = monthly[idx as number]
          return (
            <div key={label}>
              <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--text-muted)' }}>{label}</div>
              <div className="relative">
                <select
                  value={idx as number}
                  onChange={e => handleManualChange(which, Number(e.target.value))}
                  className="w-full rounded-lg px-3 py-2 text-sm pr-7 appearance-none focus:outline-none"
                  style={{
                    background: 'var(--bg-base)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {monthly.map((m, i) => (
                    <option key={m.date} value={i}>{fmtMonthLabel(m.date)}</option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" width="10" height="6" viewBox="0 0 10 6" fill="none">
                  <path d="M1 1l4 4 4-4" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              {pt && (
                <div className="text-xs mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
                  {fmtMoney(pt.nw)}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Results */}
      <div className="grid grid-cols-2 gap-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
        <div>
          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
            {cagr != null ? 'CAGR (annualised)' : 'Total return'}
          </div>
          <div className={`text-2xl font-bold ${shown != null ? pctColor(shown) : ''}`}
            style={{ color: shown == null ? 'var(--text-muted)' : undefined }}>
            {shown != null ? `${shown >= 0 ? '+' : ''}${shown.toFixed(2)}%` : '—'}
          </div>
          {years > 0 && (
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {periodLabel}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Total growth</div>
          {startPoint && endPoint ? (
            <>
              <div className={`text-2xl font-bold ${pctColor(endPoint.nw - startPoint.nw)}`}>
                {endPoint.nw >= startPoint.nw ? '+' : ''}{fmtMoney(endPoint.nw - startPoint.nw)}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {startPoint.nw > 0
                  ? `${((endPoint.nw - startPoint.nw) / startPoint.nw * 100).toFixed(1)}% absolute`
                  : ''}
              </div>
            </>
          ) : <div className="text-2xl font-bold" style={{ color: 'var(--text-muted)' }}>—</div>}
        </div>
      </div>
    </div>
  )
}

const COL_HEADERS = [
  { key: 'fy', label: 'FY', align: 'left' },
  { key: 'nw_end', label: 'NW End', align: 'right' },
  { key: 'prior_nw', label: 'Prior NW', align: 'right' },
  { key: 'growth_dollar', label: 'Growth $', align: 'right' },
  { key: 'growth_pct', label: 'Growth %', align: 'right' },
  { key: 'best_month', label: 'Best Mo', align: 'right' },
  { key: 'worst_month', label: 'Worst Mo', align: 'right' },
  { key: 'avg_mom', label: 'Avg MoM', align: 'right' },
  { key: 'portfolio_end', label: 'Portfolio', align: 'right' },
  { key: 'cash_end', label: 'Cash', align: 'right' },
  { key: 'port_pct', label: 'Port %', align: 'right' },
] as const

export default function Compounder() {
  const { data, isLoading, isError } = useCompounder()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Computing FY snapshots…</div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>No data available yet.</div>
      </div>
    )
  }

  const { summary, fy_rows, monthly } = data
  const reversedRows = [...fy_rows].reverse()

  // No max-width here: every other tab fills the page, and capping this one at 6xl
  // left a third of a wide screen empty while the FY snapshots table — the widest
  // thing on the page — was the one being squeezed.
  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="Peak Net Worth"
          value={fmtMoney(summary.peak_nw)}
          sub="all-time high"
        />
        <SummaryCard
          label="Avg Monthly MoM"
          value={fmtPct(summary.avg_mom)}
          accent={pctColor(summary.avg_mom)}
          sub="across all months"
        />
        <SummaryCard
          label="Months Positive"
          value={String(summary.months_positive)}
          accent="text-emerald-400"
          sub={`${((summary.months_positive / (summary.months_positive + summary.months_negative)) * 100 || 0).toFixed(0)}% win rate`}
        />
        <SummaryCard
          label="Months Negative"
          value={String(summary.months_negative)}
          accent="text-red-400"
          sub={`${((summary.months_negative / (summary.months_positive + summary.months_negative)) * 100 || 0).toFixed(0)}% of months`}
        />
      </div>

      {/* Annual returns chart */}
      <FYReturnsChart fyRows={fy_rows} />

      {/* CAGR Calculator */}
      <CAGRCalculator monthly={monthly} fyRows={fy_rows} />

      {/* Forward-looking projection. Sits below the CAGR calculator deliberately:
          that one measures what actually happened, this one is a what-if, and the
          historical figures should be read first. */}
      <CompoundCalculator />

      {/* FY Annual Snapshot table */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="px-5 py-3 border-b flex items-center gap-2 flex-wrap" style={{ borderColor: 'var(--border)' }}>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            FY Annual Snapshots
          </span>
          <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Jul – Jun · Australian FY</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {COL_HEADERS.map(col => (
                  <th
                    key={col.key}
                    className={`px-4 py-2.5 text-xs font-medium ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reversedRows.map((row, i) => {
                const isCurrentFY = i === 0
                return (
                  <tr
                    key={row.fy}
                    style={{
                      borderBottom: i < reversedRows.length - 1 ? '1px solid var(--border)' : undefined,
                      background: isCurrentFY ? 'var(--bg-hover)' : undefined,
                    }}
                  >
                    <td className="px-4 py-3">
                      <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                        {row.fy}
                      </span>
                      {isCurrentFY && (
                        <span
                          className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--accent)', color: '#fff', opacity: 0.85 }}
                        >
                          current
                        </span>
                      )}
                      {row.months_count < 12 && !isCurrentFY && (
                        <span className="ml-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          {row.months_count}mo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                      {fmtMoney(row.nw_end)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                      {row.prior_nw != null ? fmtMoney(row.prior_nw) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-xs ${pctColor(row.growth_dollar)}`}>
                      {row.growth_dollar != null
                        ? `${row.growth_dollar >= 0 ? '+' : ''}${fmtMoney(row.growth_dollar)}`
                        : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-xs font-semibold ${pctColor(row.growth_pct)}`}>
                      {fmtPct(row.growth_pct)}
                    </td>
                    {/* Colour and sign follow the actual value, not the column's usual
                        direction — a partial FY can end up with only one completed month
                        on record, making best_month == worst_month, and that lone sample
                        can be negative. Hardcoding '+' and green here previously showed a
                        loss as a gain the moment that happened. */}
                    <td className={`px-4 py-3 text-right font-mono text-xs ${pctColor(row.best_month)}`}>
                      {row.best_month != null
                        ? `${row.best_month >= 0 ? '+' : ''}${row.best_month.toFixed(2)}%`
                        : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-xs ${pctColor(row.worst_month)}`}>
                      {row.worst_month != null
                        ? `${row.worst_month >= 0 ? '+' : ''}${row.worst_month.toFixed(2)}%`
                        : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-xs ${pctColor(row.avg_mom)}`}>
                      {fmtPct(row.avg_mom)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                      {fmtMoney(row.portfolio_end)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                      {fmtMoney(row.cash_end)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                      {row.port_pct != null ? `${row.port_pct.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                )
              })}
              {fy_rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    No snapshot data available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
