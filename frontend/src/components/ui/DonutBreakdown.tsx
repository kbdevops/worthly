import { useState } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { fmtCurrency, fmtCurrencyCompact } from '../../lib/utils'
import { chartColor } from '../../lib/chartColors'
import { LogoBadge } from './LogoBadge'

export interface DonutSlice {
  name: string
  value: number
  /** Holdings pass a logo; allocation slices don't and get a colour dot instead. */
  logo_url?: string
}

/**
 * One donut-plus-ranked-list, shared by Portfolio Holdings and every allocation
 * widget (Country / Exchange / Sector / Custom).
 *
 * These were previously two separate implementations: holdings had a hover-linked
 * donut with a value list, while the allocation widgets used a bare Recharts
 * <Legend> that only showed names — no percentage, no dollar value. Same job, two
 * designs. This is the holdings pattern, generalised.
 *
 * Responsive behaviour is CSS container queries (see .db-* in index.css), so the
 * same component adapts whether it is 320px wide or 1300px, with no measurement.
 *
 * Slices are sorted largest-first so the colour ramp always runs in size order.
 */
export function DonutBreakdown({
  data,
  size = 200,
  showLogos = false,
  totalLabel = 'Total',
  fill = false,
  columns = 1,
}: {
  data: DonutSlice[]
  size?: number
  showLogos?: boolean
  totalLabel?: string
  /** Stretch to the parent's height. */
  fill?: boolean
  /** Allow the list to split into two columns once the container is wide enough. */
  columns?: 1 | 2
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const slices = [...data].sort((a, b) => b.value - a.value)
  const total = slices.reduce((s, d) => s + d.value, 0)
  const active = hoverIdx !== null ? slices[hoverIdx] : null

  // The centre label has only the donut's hole to work with — innerRadius is 58%,
  // minus a little breathing room. Below roughly 110px a full figure like
  // $759,570.17 cannot fit at a readable size, so it drops to the short form.
  const hole = Math.round(size * 0.58) - 6
  const tight = hole < 110
  const valueFont = Math.max(11, Math.min(20, Math.round(hole * 0.17)))

  // Two columns only ever splits a list long enough to benefit; the CSS decides
  // whether there is room, this decides whether it is worth doing at all.
  const colCount = columns === 2 && slices.length >= 6 ? 2 : 1
  const per = Math.ceil(slices.length / colCount)

  return (
    <div className={`db-root${fill ? ' db-fill' : ''}`}>
      <div className={`db-layout${fill ? ' db-fill' : ''}`}>
        <div className="db-donut" style={{ width: size, height: size }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                innerRadius="58%"
                outerRadius="80%"
                paddingAngle={1.5}
                startAngle={90}
                endAngle={-270}
                isAnimationActive={false}
                onMouseEnter={(_, i) => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              >
                {slices.map((_, i) => (
                  <Cell
                    key={i}
                    fill={chartColor(i)}
                    stroke="transparent"
                    opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.35}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          {/* Centre label doubles as the readout — a floating tooltip would sit on
              top of this text, which is why hovering swaps the centre instead.
              Clamped to the hole, or a long value runs out over the ring itself. */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div style={{ width: hole }} className="text-center">
              <span className="block text-[10px] text-slate-500 uppercase tracking-wider truncate">
                {active ? active.name : totalLabel}
              </span>
              <span
                className="block font-semibold text-white leading-tight truncate tabular-nums"
                style={{ fontSize: valueFont }}
                title={fmtCurrency(active ? active.value : total)}
              >
                {tight
                  ? fmtCurrencyCompact(active ? active.value : total)
                  : fmtCurrency(active ? active.value : total)}
              </span>
            </div>
          </div>
        </div>

        <div className={`db-list${colCount === 2 ? ' db-cols-2' : ''}`}>
          {Array.from({ length: colCount }, (_, col) => (
            <ul key={col} className="flex flex-col divide-y divide-slate-800/60 min-w-0 self-start">
              {slices.slice(col * per, (col + 1) * per).map((d, j) => {
                const i = col * per + j             // global rank drives the colour
                const pct = total > 0 ? (d.value / total) * 100 : 0
                return (
                  <li
                    key={d.name}
                    className="flex items-center gap-3 py-2 first:pt-0 transition-opacity"
                    style={{ opacity: hoverIdx === null || hoverIdx === i ? 1 : 0.45 }}
                    onMouseEnter={() => setHoverIdx(i)}
                    onMouseLeave={() => setHoverIdx(null)}
                  >
                    {showLogos ? (
                      <LogoBadge logoUrl={d.logo_url ?? ''} ticker={d.name} size={26} color={chartColor(i)} />
                    ) : (
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: chartColor(i) }} />
                    )}
                    {/* Fixed, not flex — a short ticker shouldn't claim half the row. */}
                    <span className="text-xs font-semibold text-slate-200 truncate shrink-0 w-24">
                      {d.name}
                    </span>
                    {/* The bar absorbs leftover width, so space goes to the chart
                        rather than into an empty gap. */}
                    <div className="db-bar flex-1 min-w-0 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: chartColor(i) }} />
                    </div>
                    <span className="text-xs text-slate-400 text-right shrink-0 tabular-nums w-12">
                      {pct.toFixed(1)}%
                    </span>
                    <span className="text-xs text-slate-300 text-right shrink-0 tabular-nums w-24">
                      {fmtCurrency(d.value)}
                    </span>
                  </li>
                )
              })}
            </ul>
          ))}
        </div>
      </div>
    </div>
  )
}
