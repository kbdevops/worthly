import { useState, useCallback, useEffect } from 'react'
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Settings, X, Eye, EyeOff } from 'lucide-react'
import { useBreakdown, useStats, useNetworth, useMonthlyChange, useAllocation, usePortfolio } from '../../hooks/useApi'
import { fmtCurrency, fmtCurrencySigned, fmtPct } from '../../lib/utils'

const CARD = 'rounded-xl p-5 border border-[var(--border)]'
const CARD_BG = { background: 'var(--bg-card)' }
const COLORS = ['#6366f1','#a855f7','#06b6d4','#10b981','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6','#f97316']

// ── localStorage helpers ──────────────────────────────────────────────────────
function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key)
      return s ? JSON.parse(s) : initial
    } catch { return initial }
  })
  const set = useCallback((v: T) => {
    setVal(v)
    localStorage.setItem(key, JSON.stringify(v))
  }, [key])
  return [val, set]
}

// ── Stat card config ──────────────────────────────────────────────────────────
type StatKey = 'net_worth' | 'portfolio' | 'super' | 'cash' | 'total_return' | 'return_pct' | 'best' | 'worst' | 'all_time_high'

const STAT_OPTIONS: { key: StatKey; label: string }[] = [
  { key: 'net_worth',     label: 'Total Net Worth' },
  { key: 'portfolio',     label: 'Portfolio Value' },
  { key: 'super',         label: 'Superannuation' },
  { key: 'cash',          label: 'Cash' },
  { key: 'total_return',  label: 'Total Return ($)' },
  { key: 'return_pct',    label: 'Total Return (%)' },
  { key: 'best',          label: 'Best Performer' },
  { key: 'worst',         label: 'Worst Performer' },
  { key: 'all_time_high', label: 'Portfolio All-Time High' },
]

// ── Widget definitions ────────────────────────────────────────────────────────
type WidgetId = 'networth' | 'allocation' | 'monthly' | 'country' | 'performance'

const WIDGET_LABELS: Record<WidgetId, string> = {
  networth:    'Net Worth Timeline',
  allocation:  'Asset Allocation',
  monthly:     'Monthly Change',
  country:     'Country Allocation',
  performance: 'Holding Performance',
}

const DEFAULT_ORDER: WidgetId[] = ['networth', 'allocation', 'monthly', 'country', 'performance']
const DEFAULT_VISIBLE: Record<WidgetId, boolean> = {
  networth: true, allocation: true, monthly: true, country: true, performance: true,
}
const DEFAULT_STATS: StatKey[] = ['net_worth', 'portfolio', 'super', 'cash']

// ── Time range ────────────────────────────────────────────────────────────────
type Range = '1M' | '3M' | '6M' | '1Y' | 'All'

function filterByRange<T extends { date: string }>(data: T[], range: Range): T[] {
  if (range === 'All' || !data.length) return data
  const days: Record<Range, number> = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365, All: 0 }
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days[range])
  const cutStr = cutoff.toISOString().slice(0, 10)
  return data.filter(d => d.date >= cutStr)
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className={CARD} style={CARD_BG}>
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className="text-2xl font-bold text-white" style={color ? { color } : {}}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

// ── Sortable widget wrapper ────────────────────────────────────────────────────
function SortableWidget({ id, colSpan, children }: { id: WidgetId; colSpan?: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      className={colSpan ?? ''}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
    >
      <div className="relative group h-full">
        <div
          {...attributes}
          {...listeners}
          className="absolute top-3 right-3 z-10 p-1 rounded cursor-grab text-slate-600 hover:text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <GripVertical size={16} />
        </div>
        {children}
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { data: bd } = useBreakdown()
  const { data: stats } = useStats()
  const { data: nw } = useNetworth()
  const { data: mc } = useMonthlyChange()
  const { data: alloc } = useAllocation()
  const { data: portfolio } = usePortfolio()

  const [theme, setThemeRaw] = useLocalStorage<string>('dash_theme', 'indigo')
  function setTheme(t: string) {
    setThemeRaw(t)
    document.documentElement.setAttribute('data-theme', t)
  }
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [])

  const [range, setRange] = useLocalStorage<Range>('dash_range', 'All')
  type NWLine = 'Net Worth' | 'Portfolio' | 'Cash' | 'Super' | 'Return'
  const NW_LINES: { key: NWLine; color: string }[] = [
    { key: 'Net Worth', color: '#6366f1' },
    { key: 'Portfolio', color: '#10b981' },
    { key: 'Return',    color: '#f59e0b' },
    { key: 'Cash',      color: '#06b6d4' },
    { key: 'Super',     color: '#a855f7' },
  ]
  const [activeLines, setActiveLines] = useLocalStorage<NWLine[]>('dash_nw_lines', ['Net Worth', 'Portfolio', 'Cash', 'Super'])
  function toggleLine(k: NWLine) {
    setActiveLines(activeLines.includes(k)
      ? activeLines.length > 1 ? activeLines.filter(l => l !== k) : activeLines
      : [...activeLines, k]
    )
  }
  const [order, setOrder] = useLocalStorage<WidgetId[]>('dash_order', DEFAULT_ORDER)
  const [visible, setVisible] = useLocalStorage<Record<WidgetId, boolean>>('dash_visible', DEFAULT_VISIBLE)
  const [statKeys, setStatKeys] = useLocalStorage<StatKey[]>('dash_stats', DEFAULT_STATS)
  const [showCustomise, setShowCustomise] = useState(false)

  // ── Data transforms ──────────────────────────────────────────────────────
  const nwRaw = (() => {
    if (!nw) return []
    const step = Math.max(1, Math.floor(nw.dates.length / 200))
    return nw.dates
      .filter((_, i) => i % step === 0 || i === nw.dates.length - 1)
      .map((d, i) => {
        const idx = Math.min(i * step, nw.dates.length - 1)
        return {
          date: d.slice(0, 10),
          'Net Worth': nw.net_worth[idx],
          Portfolio: nw.portfolio[idx],
          Return: nw.return_val[idx],
          Cash: nw.cash[idx],
          Super: nw.super[idx],
        }
      })
  })()

  const nwData = filterByRange(nwRaw, range)

  const mcData = mc
    ? mc.months.map((m, i) => ({ month: m, change: mc.change[i], pct: mc.change_pct[i] }))
    : []

  const allocData = alloc
    ? Object.entries(alloc.countries).map(([name, v]) => ({ name, value: v.value, pct: v.pct }))
    : []

  const assetData = bd
    ? [
        { name: 'Stocks Active', value: bd.stocks_active },
        { name: 'Stocks Passive', value: bd.stocks_passive },
        { name: 'Super', value: bd.super },
        { name: 'Cash', value: bd.cash },
      ].filter(d => d.value > 0)
    : []

  const perfData = portfolio
    ? [...portfolio]
        .filter(h => h.units > 0)
        .sort((a, b) => b.return_pct - a.return_pct)
        .map(h => ({ ticker: h.ticker, gain_pct: h.return_pct }))
    : []

  // ── Stat values ──────────────────────────────────────────────────────────
  const totalReturn = stats?.total_return ?? 0
  const returnPct = stats?.total_return_pct ?? 0

  function resolveStatCard(key: StatKey): { label: string; value: string; sub?: string; color?: string } {
    switch (key) {
      case 'net_worth':    return { label: 'Total Net Worth',   value: fmtCurrency(bd?.total ?? 0) }
      case 'portfolio':    return { label: 'Portfolio Value',   value: fmtCurrency(bd?.portfolio ?? 0), sub: `Return: ${fmtCurrencySigned(totalReturn)} (${fmtPct(returnPct)})`, color: totalReturn >= 0 ? '#10b981' : '#ef4444' }
      case 'super':        return { label: 'Superannuation',    value: fmtCurrency(bd?.super ?? 0) }
      case 'cash':         return { label: 'Cash',              value: fmtCurrency(bd?.cash ?? 0) }
      case 'total_return': return { label: 'Total Return ($)',  value: fmtCurrencySigned(totalReturn), color: totalReturn >= 0 ? '#10b981' : '#ef4444' }
      case 'return_pct':   return { label: 'Total Return (%)',  value: fmtPct(returnPct), color: returnPct >= 0 ? '#10b981' : '#ef4444' }
      case 'best':         return { label: 'Best Performer',    value: stats?.best_performer ?? '—', sub: stats?.best_performer ? fmtPct(stats.best_performer_pct) : undefined, color: '#10b981' }
      case 'worst':        return { label: 'Worst Performer',   value: stats?.worst_performer ?? '—', sub: stats?.worst_performer ? fmtPct(stats.worst_performer_pct) : undefined, color: '#ef4444' }
      case 'all_time_high': {
        const athDate = stats?.all_time_high_date
          ? new Date(stats.all_time_high_date).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' })
          : undefined
        return { label: 'Portfolio All-Time High', value: fmtCurrency(stats?.all_time_high ?? 0), sub: athDate, color: '#f59e0b' }
      }
    }
  }

  // ── Drag & drop ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (over && active.id !== over.id) {
      const oldIdx = order.indexOf(active.id as WidgetId)
      const newIdx = order.indexOf(over.id as WidgetId)
      setOrder(arrayMove(order, oldIdx, newIdx))
    }
  }

  function toggleWidget(id: WidgetId) {
    setVisible({ ...visible, [id]: !visible[id] })
  }

  function toggleStat(key: StatKey) {
    if (statKeys.includes(key)) {
      if (statKeys.length === 1) return
      setStatKeys(statKeys.filter(k => k !== key))
    } else {
      if (statKeys.length >= 4) {
        setStatKeys([...statKeys.slice(1), key])
      } else {
        setStatKeys([...statKeys, key])
      }
    }
  }

  // ── Widget renderers ─────────────────────────────────────────────────────
  const tooltipStyle = { contentStyle: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }, labelStyle: { color: '#94a3b8' } }

  const ranges: Range[] = ['1M', '3M', '6M', '1Y', 'All']

  function renderWidget(id: WidgetId) {
    switch (id) {
      case 'networth':
        return (
          <div className={CARD} style={CARD_BG}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                <p className="text-sm font-medium text-slate-300">Net Worth Timeline</p>
                <div className="flex gap-1">
                  {NW_LINES.map(l => (
                    <button
                      key={l.key}
                      onClick={() => toggleLine(l.key)}
                      className={`px-2.5 py-0.5 text-xs rounded-full border font-medium transition-colors ${activeLines.includes(l.key) ? 'text-white' : 'border-[#20264b] text-slate-600'}`}
                      style={activeLines.includes(l.key) ? { borderColor: l.color, background: l.color + '22', color: l.color } : {}}
                    >{l.key}</button>
                  ))}
                </div>
              </div>
              <div className="flex gap-1">
                {ranges.map(r => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={`px-2 py-0.5 text-xs rounded font-medium transition-colors ${range === r ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                  >{r}</button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={nwData}>
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'} />
                <Tooltip formatter={(v) => fmtCurrency(v as number)} {...tooltipStyle} />
                {NW_LINES.filter(l => activeLines.includes(l.key)).map(l => (
                  <Line key={l.key} type="monotone" dataKey={l.key} stroke={l.color} dot={false} strokeWidth={l.key === 'Net Worth' ? 2 : 1.5} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )

      case 'allocation':
        return (
          <div className={CARD} style={CARD_BG}>
            <p className="text-sm font-medium text-slate-300 mb-4">Asset Allocation</p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={assetData} dataKey="value" innerRadius="60%" outerRadius="80%" paddingAngle={3}>
                  {assetData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => fmtCurrency(v as number)} {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )

      case 'monthly':
        return (
          <div className={CARD} style={CARD_BG}>
            <p className="text-sm font-medium text-slate-300 mb-4">Monthly Change</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={mcData}>
                <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'} />
                <Tooltip formatter={(v) => fmtCurrencySigned(v as number)} {...tooltipStyle} />
                <Bar dataKey="change" radius={4}>
                  {mcData.map((d, i) => <Cell key={i} fill={d.change >= 0 ? '#10b981' : '#ef4444'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )

      case 'country':
        return (
          <div className={CARD} style={CARD_BG}>
            <p className="text-sm font-medium text-slate-300 mb-4">Country Allocation</p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={allocData} dataKey="value" innerRadius="60%" outerRadius="80%" paddingAngle={3}>
                  {allocData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => fmtCurrency(v as number)} {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )

      case 'performance':
        return (
          <div className={CARD} style={CARD_BG}>
            <p className="text-sm font-medium text-slate-300 mb-4">Holding Performance</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={perfData} layout="vertical">
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => v + '%'} />
                <YAxis type="category" dataKey="ticker" tick={{ fill: '#94a3b8', fontSize: 11 }} tickLine={false} axisLine={false} width={50} />
                <Tooltip formatter={(v) => fmtPct(v as number)} {...tooltipStyle} />
                <Bar dataKey="gain_pct" radius={4}>
                  {perfData.map((d, i) => <Cell key={i} fill={d.gain_pct >= 0 ? '#10b981' : '#ef4444'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
    }
  }

  // ── Determine grid layout for widget groups ──────────────────────────────
  // networth spans 2 cols, the rest span 1
  const visibleOrder = order.filter(id => visible[id])

  return (
    <div className="space-y-6">
      {/* Header with customise toggle */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowCustomise(v => !v)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-[#20264b] text-slate-400 hover:text-white hover:border-indigo-500 transition-colors"
        >
          <Settings size={13} />
          Customise
        </button>
      </div>

      {/* Customise panel */}
      {showCustomise && (
        <div className={`${CARD} space-y-5`} style={CARD_BG}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Dashboard Settings</p>
            <button onClick={() => setShowCustomise(false)} className="text-slate-500 hover:text-white"><X size={16} /></button>
          </div>

          {/* Stat cards */}
          <div>
            <p className="text-xs text-slate-400 mb-2">Stat Cards <span className="text-slate-600">(pick up to 4)</span></p>
            <div className="flex flex-wrap gap-2">
              {STAT_OPTIONS.map(opt => {
                const on = statKeys.includes(opt.key)
                return (
                  <button
                    key={opt.key}
                    onClick={() => toggleStat(opt.key)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${on ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300' : 'border-[#20264b] text-slate-400 hover:border-slate-500'}`}
                  >{opt.label}</button>
                )
              })}
            </div>
          </div>

          {/* Theme */}
          <div>
            <p className="text-xs text-slate-400 mb-2">Theme</p>
            <div className="flex gap-3">
              {([
                { id: 'indigo',   color: '#6366f1', label: 'Indigo' },
                { id: 'midnight', color: '#a855f7', label: 'Midnight' },
                { id: 'emerald',  color: '#10b981', label: 'Emerald' },
                { id: 'rose',     color: '#f43f5e', label: 'Rose' },
                { id: 'amber',    color: '#f59e0b', label: 'Amber' },
              ] as { id: string; color: string; label: string }[]).map(t => (
                <button key={t.id} onClick={() => setTheme(t.id)} title={t.label}
                  className="flex flex-col items-center gap-1.5 group">
                  <div className="w-7 h-7 rounded-full transition-all"
                    style={{
                      background: t.color,
                      outline: theme === t.id ? `3px solid ${t.color}` : '3px solid transparent',
                      outlineOffset: '3px',
                    }} />
                  <span className={`text-[10px] ${theme === t.id ? 'text-white' : 'text-slate-600'}`}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Widget visibility */}
          <div>
            <p className="text-xs text-slate-400 mb-2">Widgets</p>
            <div className="flex flex-wrap gap-2">
              {order.map(id => (
                <button
                  key={id}
                  onClick={() => toggleWidget(id)}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-full border transition-colors ${visible[id] ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300' : 'border-[#20264b] text-slate-500'}`}
                >
                  {visible[id] ? <Eye size={11} /> : <EyeOff size={11} />}
                  {WIDGET_LABELS[id]}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-slate-600">Drag the <GripVertical size={11} className="inline" /> handle on any widget to reorder.</p>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {statKeys.map(key => {
          const c = resolveStatCard(key)
          return <StatCard key={key} {...c} />
        })}
      </div>

      {/* Sortable widgets */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleOrder} strategy={verticalListSortingStrategy}>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {visibleOrder.map(id => (
              <SortableWidget key={id} id={id} colSpan={id === 'networth' ? 'xl:col-span-3' : ''}>
                {renderWidget(id)}
              </SortableWidget>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
