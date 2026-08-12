import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Line, BarChart, Bar, Cell, LabelList,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Treemap,
  ComposedChart, Area, CartesianGrid, AreaChart, ReferenceLine,
} from 'recharts'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import type { Holding } from '../../types'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Settings, X, Eye, EyeOff, Pencil, Plus, Trash2, Check } from 'lucide-react'
import { useBreakdown, useStats, useNetworth, useMonthlyChange, useAllocation, usePortfolio, useSyncStatus, useDashboardLayout, useSaveDashboardLayout, useCountryOverrides, useSaveCountryOverrides, useRangePerformance, useExtendedHours, usePerformance } from '../../hooks/useApi'
import { fmtCurrency, fmtCurrencySigned, fmtPct, fmtDate } from '../../lib/utils'
import { SERIES_COLORS } from '../../lib/chartColors'
import { DonutBreakdown } from '../ui/DonutBreakdown'
import { LogoBadge } from '../ui/LogoBadge'

const CARD = 'rounded-xl p-5 border border-[var(--border)]'
const CARD_BG = { background: 'var(--bg-card)' }

// Accent hue/chroma per preset — mirrors the seeds in index.css so the swatch
// shows the colour the theme will actually produce.
const THEMES: { id: string; label: string; ha: number; ca: number }[] = [
  { id: 'indigo',   label: 'Indigo',   ha: 272, ca: 0.170 },
  { id: 'graphite', label: 'Graphite', ha: 75,  ca: 0.145 },
  { id: 'harbour',  label: 'Harbour',  ha: 208, ca: 0.130 },
  { id: 'orchid',   label: 'Orchid',   ha: 322, ca: 0.150 },
  { id: 'tonal',    label: 'Tonal',    ha: 240, ca: 0.100 },
]

/**
 * Resolve CSS custom properties to concrete colour strings.
 *
 * Recharts writes `fill` / `stroke` as SVG *attributes*, and an SVG attribute will
 * not accept `var(--x)` — it silently renders nothing. Reading the property off
 * :root isn't enough either, because tokens like `oklch(… calc(var(--ha) - 25))`
 * come back with the calc() unevaluated. Painting it onto a probe element and
 * reading back the computed `color` forces full evaluation.
 */
function useThemeColors(names: string[]): Record<string, string> {
  const key = names.join(',')
  const [colors, setColors] = useState<Record<string, string>>({})

  useEffect(() => {
    const probe = document.createElement('span')
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
    document.body.appendChild(probe)

    // On a cold load the stylesheet may not have applied yet. An unresolved token
    // makes `color` invalid at computed-value time, so it silently inherits from
    // body — which is how every band once came back the same near-white grey and
    // stayed that way, because the read only ever happened once. The sentinel makes
    // "not ready" detectable so we can retry instead of caching the wrong answer.
    const SENTINEL = 'rgb(1, 2, 3)'
    let timers: number[] = []

    const read = (): boolean => {
      const next: Record<string, string> = {}
      for (const n of key.split(',')) {
        probe.style.color = ''
        probe.style.color = `var(${n}, ${SENTINEL})`
        const v = getComputedStyle(probe).color
        if (v === SENTINEL) return false      // stylesheet not live yet
        next[n] = v
      }
      setColors(next)
      return true
    }

    const readWithRetry = () => {
      if (read()) return
      timers.forEach(clearTimeout)
      timers = [16, 60, 200, 600, 1500].map(ms =>
        window.setTimeout(() => { read() }, ms))
    }

    readWithRetry()
    window.addEventListener('load', readWithRetry)

    // Theme changes arrive either as a data-theme swap or an inline seed override
    // from the custom-hue slider — both land on <html>.
    const mo = new MutationObserver(readWithRetry)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })

    return () => {
      mo.disconnect()
      window.removeEventListener('load', readWithRetry)
      timers.forEach(clearTimeout)
      probe.remove()
    }
  }, [key])

  return colors
}

// Gain sits at hue 158 and loss at 22. An accent parked beside either starts to
// read as a verdict rather than an affordance, so warn instead of allowing it silently.
function hueClash(hue: number): string | null {
  const gap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d) }
  if (gap(hue, 158) < 22) return 'the gain green'
  if (gap(hue, 22) < 22) return 'the loss red'
  return null
}

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
type StatKey = 'net_worth' | 'portfolio' | 'super' | 'cash' | 'total_return' | 'return_pct' | 'best' | 'worst' | 'daily_ath' | 'day_pl' | 'cost_basis' | 'cagr' | 'dividends'
  | 'realised' | 'total_all' | 'income_fy' | 'ext_hours'

// Only metrics that appear NOWHERE else on the dashboard. Everything removed from this
// list is already shown by the hero panel (net worth, portfolio, super, cash, today's
// P&L), the return ledger (total/unrealised/realised/income) or the Holding Performance
// treemap (best/worst, and there with position weight). Dropping them from the options
// rather than migrating saved layouts is deliberate: cleanedStatKeys filters by this
// list, so a stale saved list can no longer resurrect them — a one-time migration lost
// that race against localStorage every time.
const STAT_OPTIONS: { key: StatKey; label: string }[] = [
  // 'cagr' now renders the money-weighted return. The key is deliberately unchanged
  // so saved layouts keep working — only the maths and the label moved.
  { key: 'cagr',        label: 'Return p.a.' },
  { key: 'return_pct',  label: 'Return (%)' },
  { key: 'income_fy',   label: 'Income This FY' },
  { key: 'ext_hours',   label: 'Pre / After Market' },
  { key: 'daily_ath',   label: 'Best Day Ever' },
  { key: 'cost_basis',  label: 'Cost Basis' },
]

// ── Allocation widget types ───────────────────────────────────────────────────
// Auto dimensions: group all holdings by a shared property
// Custom: user defines each named slice and picks which holdings go in it
type AllocDimension = 'country' | 'sector' | 'exchange' | 'custom'

interface AllocSlice {
  name: string
  // ticker symbols from portfolio; '__CASH__' = all cash accounts; '__SUPER__' = all super
  items: string[]
}

interface AllocWidgetConfig {
  id: string
  name: string
  dimension: AllocDimension
  slices?: AllocSlice[]   // only used when dimension === 'custom'
}

const ALLOC_DIMENSION_LABELS: Record<AllocDimension, string> = {
  country:  'Country',
  sector:   'Sector',
  exchange: 'Exchange',
  custom:   'Custom',
}

const DEFAULT_ALLOC_WIDGETS: AllocWidgetConfig[] = [
  { id: 'alloc_country',  name: 'Country Allocation',  dimension: 'country' },
  { id: 'alloc_sector',   name: 'Sector Allocation',   dimension: 'sector' },
  { id: 'alloc_exchange', name: 'Exchange Allocation', dimension: 'exchange' },
]

const COUNTRY_OPTIONS = ['AU', 'US', 'UK', 'JP', 'CN', 'EU', 'CA', 'SG', 'HK', 'NZ', 'DE', 'FR', 'IN']

function exchangeToCountry(exchange: string): string {
  const map: Record<string, string> = {
    ASX: 'AU', NASDAQ: 'US', NYSE: 'US', LSE: 'UK',
    TSX: 'CA', TSE: 'JP', HKEX: 'HK', SGX: 'SG', NZX: 'NZ',
  }
  return map[(exchange ?? '').toUpperCase()] ?? '??'
}

// ── Fixed widget definitions ─────────────────────────────────────────────────
type FixedWidgetId = 'perf_chart' | 'networth' | 'monthly' | 'performance' | 'holdings'

const FIXED_WIDGET_LABELS: Record<FixedWidgetId, string> = {
  perf_chart:  'Performance',
  networth:    'Net Worth Timeline',
  monthly:     'Monthly Change',
  // Id stays 'performance' so saved layouts keep working; only the label moved. The
  // return chart that now owns the name is 'perf_chart'.
  performance: 'Allocation',
  holdings:    'Portfolio Holdings',
}

const DEFAULT_ORDER: string[] = [
  'perf_chart', 'performance',                            // ½ + ½
  'networth',                                             // full
  'alloc_country', 'alloc_sector', 'alloc_exchange',      // ⅓ + ⅓ + ⅓
  'monthly',                                              // full
  'holdings',                                             // full
]

// Fixed column span per widget, out of 6. Net worth and holding performance sit
// side by side at a half each; the holdings list needs the full width for its
// donut plus two-column legend; the rest take a third.
// Defaults only — every widget's width is user-settable in Dashboard Settings and
// persisted per widget, so this is the starting point rather than the law.
const WIDGET_SPAN: Record<string, number> = {
  perf_chart: 3,
  networth: 6,
  performance: 3,
  holdings: 6,
  // Full width: 60+ monthly bars are unreadable squeezed into a third of the row.
  monthly: 6,
}
const spanOf = (id: string) => WIDGET_SPAN[id] ?? 2
/** Widths a widget can be set to, out of the 6-column grid. Thirds and halves only:
 *  arbitrary spans leave ragged gaps because the row has to divide evenly. */
const SPAN_CHOICES: { span: number; label: string }[] = [
  { span: 2, label: '⅓' },
  { span: 3, label: '½' },
  { span: 6, label: 'Full' },
]

/** Narrowest width at which a widget still says something. Offering a size that
 *  visibly breaks the content isn't a choice, it's a trap — Portfolio Holdings at a
 *  third clips its legend, and Monthly Change becomes 60 unreadable slivers. Widths
 *  below these are removed from the picker AND clamped on read, so a layout already
 *  saved too small repairs itself rather than staying broken. */
const MIN_SPAN: Record<string, number> = {
  holdings: 6,      // donut plus a two-column legend
  monthly: 6,       // 60+ bars; the existing comment says as much
  perf_chart: 3,    // range dial + benchmark chip + legend won't fit a third
  networth: 3,      // four series and a range dial
  performance: 3,   // treemap tiles drop their labels below this
}
const minSpanOf = (id: string) => MIN_SPAN[id] ?? 2
const spanChoicesFor = (id: string) => SPAN_CHOICES.filter(c => c.span >= minSpanOf(id))

// Shared height for the three full-width widgets so they read as one rhythm down
// the page. Sized to the tallest natural content (Portfolio Holdings' 11-row list)
// so nothing has to scroll or be clipped — the charts simply get more room.
const FULL_WIDGET_H = 560

// Fixed abbreviations rather than toLocaleDateString: en-AU renders "short" months
// unevenly, spelling June and July in full beside Aug, which reads as broken on an axis.
// Parsed as parts and never via Date(str) — a bare yyyy-mm-dd is treated as UTC midnight
// and shifts back a day in eastern timezones.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Phone-width, for the handful of places where a Tailwind class can't help because the
 *  DATA has to change rather than the styling. Matches Tailwind's `md` breakpoint. */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

/** "2026-05-01" -> "1 May" */
const dayMonth = (iso: string): string => {
  const [, m, d] = iso.split('-').map(Number)
  return m && d ? `${d} ${MONTHS[m - 1]}` : iso
}

/** "2026-08-01" -> "Aug 26" */
const monthLabel = (iso: string): string => {
  const [y, m] = iso.split('-').map(Number)
  return y && m ? `${MONTHS[m - 1]} ${String(y).slice(2)}` : iso
}
// Everything in DEFAULT_ORDER, on. A key missing here reads as visible anyway
// (visible[id] !== false), but listing them keeps the two in step when either moves.
const DEFAULT_VISIBLE: Record<string, boolean> = {
  perf_chart: true, performance: true, networth: true,
  alloc_country: true, alloc_sector: true, alloc_exchange: true,
  monthly: true, holdings: true,
}



const DEFAULT_STATS: StatKey[] = ['cagr', 'return_pct', 'income_fy', 'cost_basis', 'daily_ath']

// ── Time range ────────────────────────────────────────────────────────────────
/** ONE range vocabulary for every widget with a dial. Each widget picks the subset
 *  that means something for it, but the words never diverge — the same window used
 *  to be "All" on the net worth chart, "Total" on Allocation and "Max" here.
 *  FY is the Australian financial year (1 July), which for an AU investor is the
 *  window that actually matters; it's the same boundary /api/stats uses for income.
 *  Dials stay INDEPENDENT rather than one shared control: Today only means anything
 *  on Allocation, and wanting Performance on Max while Allocation shows Today is the
 *  normal case, not the exception. */
type Range = 'Today' | '1W' | '1M' | '3M' | '6M' | 'YTD' | 'FY' | '1Y' | 'Max'
const RANGES_ALL: Range[] = ['Today', '1W', '1M', '3M', '6M', 'YTD', 'FY', '1Y', 'Max']
// A single point is not a timeline, so the net worth chart has no Today.
const RANGES_TIME: Range[] = RANGES_ALL.filter(r => r !== 'Today')
const ALLOC_RANGES: Range[] = RANGES_ALL
const PERF_RANGES: Range[] = RANGES_TIME
type AllocRange = Range
type PerfRange = Range

function RangeDial({ options, value, onChange, narrow }: {
  options: Range[]; value: Range; onChange: (r: Range) => void; narrow: boolean
}) {
  // Nine pills do not fit 375px. A select keeps every option reachable instead of
  // hiding some on mobile, which would make the vocabulary differ by screen size —
  // the exact problem this shared list exists to remove.
  if (narrow) {
    return (
      <select
        value={value}
        onChange={e => onChange(e.target.value as Range)}
        className="px-2 py-1 text-[11px] rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] text-slate-300 outline-none"
      >
        {options.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
    )
  }
  return (
    <div className="flex gap-0.5 flex-wrap">
      {options.map(r => (
        <button key={r} onClick={() => onChange(r)}
          className={`px-2 py-0.5 text-[11px] rounded-md font-medium transition-colors ${
            value === r ? 'bg-[var(--accent)] text-white' : 'text-slate-500 hover:text-slate-300'}`}>
          {r}
        </button>
      ))}
    </div>
  )
}

/** Saved prefs predate the shared vocabulary: 'All' and 'Total' both meant Max. */
const migrateRange = (r: string): Range =>
  (r === 'All' || r === 'Total' ? 'Max' : r as Range)

/** Mirrors range_cutoff() in app.py — same vocabulary, same boundaries. */
function rangeCutoff(range: Range): string | null {
  if (range === 'Max') return null
  const now = new Date()
  if (range === 'Today') return now.toISOString().slice(0, 10)
  if (range === 'YTD') return `${now.getFullYear()}-01-01`
  if (range === 'FY') return `${now.getFullYear() - (now.getMonth() < 6 ? 1 : 0)}-07-01`
  const days: Record<string, number> = { '1W': 7, '1M': 30, '3M': 90, '6M': 180, '1Y': 365 }
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - (days[range] ?? 0))
  return cutoff.toISOString().slice(0, 10)
}

function filterByRange<T extends { date: string }>(data: T[], range: Range): T[] {
  const cut = rangeCutoff(range)
  if (!cut || !data.length) return data
  return data.filter(d => d.date >= cut)
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className={CARD + ' min-w-0'} style={CARD_BG}>
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className="text-xl sm:text-2xl font-bold text-white truncate" title={value} style={color ? { color } : {}}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

/**
 * Net worth as the one hero figure, with the composition that produces it.
 *
 * Portfolio + Super + Cash were previously four equal-weight cards with no operator
 * between them, so the only real relationship in the data — that the three sum to the
 * headline — was invisible. The segment colours come from SERIES_COLORS so the bar
 * reads as the "now" slice of the stacked timeline directly below it.
 *
 * The delta is rebased to net worth: stats.day_pl_pct divides by the previous
 * PORTFOLIO value, which printed +1.63% beside a $1m headline that had moved +1.16%.
 */
function NetWorthHero({ netWorth, portfolio, superAnn, cash, dayPl }: {
  netWorth: number; portfolio: number; superAnn: number; cash: number; dayPl: number
}) {
  const legs = [
    { label: 'Portfolio', value: portfolio, color: SERIES_COLORS['Portfolio'] },
    { label: 'Super',     value: superAnn,  color: SERIES_COLORS['Super'] },
    { label: 'Cash',      value: cash,      color: SERIES_COLORS['Cash'] },
  ]
  const pct = (v: number) => (netWorth > 0 ? (v / netWorth) * 100 : 0)
  const prev = netWorth - dayPl
  const dayPct = prev > 0 ? (dayPl / prev) * 100 : 0
  const up = dayPl >= 0
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-slate-400">Net worth</p>
      <p className="text-3xl sm:text-4xl font-semibold text-white tabular-nums mt-1 leading-none">
        {fmtCurrency(netWorth)}
      </p>
      <span
        className="inline-block mt-2 px-2 py-1 rounded-md text-xs font-semibold tabular-nums"
        style={{
          background: up ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
          color: up ? '#10b981' : '#ef4444',
        }}
      >
        {up ? '+' : '−'}{fmtCurrency(dayPl)} · {up ? '+' : ''}{dayPct.toFixed(2)}%
      </span>
      <div className="flex h-2 rounded-full overflow-hidden mt-4">
        {legs.map(l => (
          <div key={l.label} style={{ width: `${pct(l.value)}%`, background: l.color }} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 mt-3">
        {legs.map(l => (
          <div key={l.label} className="min-w-0">
            <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: l.color }} />
              <span className="truncate">{l.label} {pct(l.value).toFixed(1)}%</span>
            </p>
            <p className="text-sm font-semibold text-white tabular-nums mt-0.5 truncate">
              {fmtCurrency(l.value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Lifetime return, split into the three things that actually make it up.
 *
 * "Total Return" previously named the unrealised figure alone, which understated
 * lifetime profit by everything banked on a sale plus every dividend — $75,720 of it
 * on the reference portfolio. The rows sum to the headline exactly.
 *
 * Franking is a row of its own rather than an annotation on Income, because it is
 * counted in the headline (see total_return_all) and every row here has to sum to
 * that. Kept separate from Income rather than merged into it because the two are
 * not the same kind of money — one is cash banked, the other an ATO offset you only
 * realise at tax time — and a single "Income" line hiding both would misreport what
 * actually landed in the account.
 */
function ReturnLedger({ total, unrealised, realised, income, franking }: {
  total: number; unrealised: number; realised: number; income: number; franking: number
}) {
  const rows = [
    { label: 'Unrealised', value: unrealised },
    { label: 'Realised',   value: realised },
    // Income is net: after US withholding, before any franking credit.
    { label: 'Income',     value: income },
    ...(franking > 0
      ? [{ label: 'Franking credits', value: franking, note: 'tax offset, not cash' }]
      : []),
  ]
  const sign = (v: number) => (v >= 0 ? '+' : '−')
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-slate-400">Total return</p>
      <p className="text-2xl sm:text-3xl font-semibold tabular-nums mt-1 leading-none"
        style={{ color: total >= 0 ? '#10b981' : '#ef4444' }}>
        {sign(total)}{fmtCurrency(total)}
      </p>
      <div className="mt-3">
        {rows.map(r => (
          <div key={r.label} className="py-1.5 border-t border-[var(--border)]">
            <div className="flex justify-between items-baseline text-xs tabular-nums">
              <span className="text-slate-400">{r.label}</span>
              <span className="font-semibold" style={{ color: r.value >= 0 ? '#10b981' : '#ef4444' }}>
                {sign(r.value)}{fmtCurrency(r.value)}
              </span>
            </div>
            {r.note && (
              <p className="text-[10px] text-slate-500 text-right tabular-nums mt-0.5">{r.note}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Sortable widget wrapper ────────────────────────────────────────────────────
// The grid is 6 columns rather than 3 purely so widgets can take a clean half
// (3/6) — with 3 columns there was no way to sit two widgets side by side evenly.
// Tailwind scans source for literal class names, so these are spelled out rather
// than built by interpolation.
const SPAN_CLASS: Record<number, string> = {
  1: 'xl:col-span-1',
  2: 'xl:col-span-2',
  3: 'xl:col-span-3',
  4: 'xl:col-span-4',
  6: 'xl:col-span-6',
}

function SortableWidget({ id, span, children }: { id: string; span: number; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      className={SPAN_CLASS[span] ?? SPAN_CLASS[1]}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
    >
      {/* No h-full: a card should be as tall as its content. Stretching every card
          to the tallest in the row is what left 400px holes under the short ones. */}
      <div className="relative group">
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

// ── Holding Performance treemap ───────────────────────────────────────────────
function perfColor(pct: number): string {
  if (pct >= 100) return '#14532d'
  if (pct >= 50)  return '#166534'
  if (pct >= 20)  return '#15803d'
  if (pct >= 5)   return '#166534cc'
  if (pct >= 0)   return '#1a3d2b'
  if (pct >= -5)  return '#3d1a1a'
  if (pct >= -20) return '#7f1d1d'
  return '#991b1b'
}

function TreemapTile(props: {
  x?: number; y?: number; width?: number; height?: number;
  name?: string; return_pct?: number; value?: number; logo_url?: string;
}) {
  const { x = 0, y = 0, width = 0, height = 0, name = '', return_pct = 0, logo_url } = props
  // Recharts calls `content` for every node in the hierarchy, including the
  // invisible root wrapping the whole chart — it has no ticker name, so skip it.
  if (!name || width < 30 || height < 30) return null

  const gap = 1.5
  const ix = x + gap, iy = y + gap, iw = width - gap * 2, ih = height - gap * 2
  const cx = ix + iw / 2
  const color = perfColor(return_pct)

  const logoR      = Math.max(10, Math.min(18, iw * 0.22, ih * 0.24))
  const fs         = Math.min(13, Math.max(9, iw / 6))
  const pfs        = Math.max(8, fs - 1.5)
  const clipId     = `clip-${name}-${Math.round(x)}`
  const tileClipId = `tileclip-${name}-${Math.round(x)}`

  // Gate each row on both min tile size and remaining vertical budget, so
  // narrow/short tiles drop the lowest-priority row (pct, then ticker, then
  // logo) instead of letting text overflow past the tile's bottom edge.
  const padV = 4
  let budget = ih - padV
  let showLogo = false, showTicker = false, showPct = false

  if (iw > 38 && ih > 44) {
    const h = logoR * 2 + 5
    if (h <= budget) { showLogo = true; budget -= h }
  }
  if (iw > 32 && ih > 22) {
    const h = fs + 2
    if (h <= budget) { showTicker = true; budget -= h }
  }
  if (iw > 32 && ih > 38) {
    if (pfs <= budget) showPct = true
  }

  const totalH =
    (showLogo   ? logoR * 2 + 5 : 0) +
    (showTicker ? fs + 2        : 0) +
    (showPct    ? pfs           : 0)
  let cy = iy + (ih - totalH) / 2

  const blocks: React.ReactNode[] = []

  if (showLogo) {
    const lcy = cy + logoR
    cy += logoR * 2 + 5
    blocks.push(
      <g key="logo">
        <defs>
          <clipPath id={clipId}>
            <circle cx={cx} cy={lcy} r={logoR} />
          </clipPath>
        </defs>
        <foreignObject x={cx - logoR - 2} y={lcy - logoR - 2} width={logoR * 2 + 4} height={logoR * 2 + 4}>
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LogoBadge logoUrl={logo_url ?? ''} ticker={name} size={logoR * 2} solid />
          </div>
        </foreignObject>
      </g>
    )
  }

  if (showTicker) {
    const ty = cy + fs
    cy += fs + 2
    blocks.push(
      <text key="tk" x={cx} y={ty} textAnchor="middle"
        fill="rgba(255,255,255,0.95)" fontSize={fs} fontWeight="700" letterSpacing="-0.3">
        {name}
      </text>
    )
  }

  if (showPct) {
    blocks.push(
      <text key="pct" x={cx} y={cy + pfs} textAnchor="middle"
        fill={return_pct >= 0 ? 'rgba(134,239,172,0.9)' : 'rgba(252,165,165,0.9)'}
        fontSize={pfs} fontWeight="500">
        {return_pct >= 0 ? '+' : ''}{return_pct.toFixed(1)}%
      </text>
    )
  }

  return (
    <g>
      <rect x={ix} y={iy} width={iw} height={ih} fill={color} rx={6} />
      <defs>
        <clipPath id={tileClipId}>
          <rect x={ix + 2} y={iy} width={Math.max(0, iw - 4)} height={ih} rx={6} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${tileClipId})`}>
        {blocks}
      </g>
    </g>
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
  const { data: syncStatuses } = useSyncStatus()
  const { data: countryOverrides } = useCountryOverrides()
  const saveOverridesMutation = useSaveCountryOverrides()

  // A theme is a seed pair (neutral hue, accent hue) — see index.css. Presets set
  // data-theme; a custom hue writes the seeds inline, which outranks the preset rule.
  const [theme, setThemeRaw] = useLocalStorage<string>('dash_theme', 'indigo')
  const [customHue, setCustomHueRaw] = useLocalStorage<number | null>('dash_hue', null)

  function applyPreset(t: string) {
    const el = document.documentElement
    ;['--h', '--cn', '--ha', '--ca'].forEach(p => el.style.removeProperty(p))
    el.setAttribute('data-theme', t)
  }
  function applyHue(hue: number) {
    const el = document.documentElement
    el.style.setProperty('--h', String(hue))
    el.style.setProperty('--cn', '0.020')
    el.style.setProperty('--ha', String(hue))
    el.style.setProperty('--ca', '0.150')
  }
  function setTheme(t: string) {
    setThemeRaw(t)
    setCustomHueRaw(null)
    applyPreset(t)
  }
  function setCustomHue(hue: number) {
    setCustomHueRaw(hue)
    applyHue(hue)
  }
  useEffect(() => {
    // Themes removed in the palette rework fall back to the default rather than
    // leaving a saved-but-unstyled value selected.
    const known = THEMES.some(t => t.id === theme)
    applyPreset(known ? theme : 'indigo')
    if (customHue != null) applyHue(customHue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [rangeRaw, setRange] = useLocalStorage<Range>('dash_range', 'Max')
  const range = migrateRange(rangeRaw)
  // Declared after `range` — the treemap follows the same selector as the chart.
  // Allocation gets its own selector: it used to borrow the net worth chart's range,
  // and "Today" is meaningless on a net worth timeline.
  const [allocRangeRaw, setAllocRange] = useLocalStorage<AllocRange>('dash_alloc_range', 'Max')
  const allocRange = migrateRange(allocRangeRaw)
  // Today reads daily_change_pct straight off the holding, so the query is only for
  // the bounded windows; anything else asks the endpoint for its lifetime figure.
  const { data: rangePerf } = useRangePerformance(allocRange === 'Today' ? 'Max' : allocRange)
  const [perfRangeRaw, setPerfRange] = useLocalStorage<PerfRange>('dash_perf_range', 'Max')
  const perfRange = migrateRange(perfRangeRaw)
  const [benchmark, setBenchmark] = useLocalStorage<string>('dash_benchmark', 'IVV.AX')
  const [benchEdit, setBenchEdit] = useState<string | null>(null)
  const { data: perf } = usePerformance(perfRange, benchmark)
  const { data: ext } = useExtendedHours()

  type NWLine = 'Net Worth' | 'Portfolio' | 'Cash' | 'Super' | 'Return'
  // Portfolio + Cash + Super sum exactly to net worth, so those three render as a
  // stack. Net Worth is drawn from its own series rather than read off the top of
  // the stack, so hiding a band shrinks the fill without ever making the headline
  // line wrong. Return isn't a component of the total — it overlays as a line.
  // Series colours come from the shared categorical palette, same as every donut,
  // so the timeline reads as part of the same system. Only the chrome (grid, axis)
  // still follows the theme, which is what the resolver is for.
  const themeColors = useThemeColors(['--border', '--text-muted'])
  const NW_LINES: { key: NWLine; color: string }[] = [
    { key: 'Net Worth', color: SERIES_COLORS['Net Worth'] },
    { key: 'Portfolio', color: SERIES_COLORS['Portfolio'] },
    { key: 'Cash',      color: SERIES_COLORS['Cash'] },
    { key: 'Super',     color: SERIES_COLORS['Super'] },
  ]
  const NW_BANDS: NWLine[] = ['Super', 'Cash', 'Portfolio']   // stack order, bottom up
  const nwColor = (k: NWLine) => NW_LINES.find(l => l.key === k)!.color
  const [activeLines, setActiveLines] = useLocalStorage<NWLine[]>('dash_nw_lines', ['Net Worth', 'Portfolio', 'Cash', 'Super'])
  const COMPOSITION: NWLine[] = ['Net Worth', 'Portfolio', 'Cash', 'Super']

  /**
   * Return is an EXCLUSIVE mode, not an overlay.
   *
   * Overlaying it meant two different zeros on one plot: Return's zero landed at the
   * same pixel height as $300k of net worth, so the moment the portfolio crossed from
   * loss into profit appeared a third of the way up the net-worth scale, and a $210k
   * return sat visually adjacent to $1.03m of net worth. Showing it alone keeps one
   * axis with one zero and nothing to misread.
   */
  function toggleLine(k: NWLine) {
    const inReturnMode = activeLines.includes('Return')
    if (k === 'Return') {
      // Toggling Return off restores the composition rather than leaving an empty chart.
      setActiveLines(inReturnMode ? COMPOSITION : ['Return'])
      return
    }
    if (inReturnMode) {
      // Picking any balance series leaves Return mode.
      setActiveLines([k])
      return
    }
    setActiveLines(activeLines.includes(k)
      ? activeLines.length > 1 ? activeLines.filter(l => l !== k) : activeLines
      : [...activeLines, k]
    )
  }

  // ── Allocation widget configs ────────────────────────────────────────────
  const [allocWidgets, setAllocWidgets] = useLocalStorage<AllocWidgetConfig[]>('dash_alloc_widgets', DEFAULT_ALLOC_WIDGETS)
  const [editingAllocId, setEditingAllocId] = useState<string | null>(null)
  const [editAllocName, setEditAllocName] = useState('')
  const [editAllocDim, setEditAllocDim] = useState<AllocDimension>('custom')
  const [editSlices, setEditSlices] = useState<AllocSlice[]>([])
  const [editOverrides, setEditOverrides] = useState<Record<string, string>>({})

  // Default names per dimension — used for auto-updating name when dimension changes
  const DIM_DEFAULT_NAMES: Record<AllocDimension, string> = {
    country:  'Country Allocation',
    sector:   'Sector Allocation',
    exchange: 'Exchange Allocation',
    custom:   'My Allocation',
  }

  function startEditAlloc(w: AllocWidgetConfig) {
    setEditingAllocId(w.id)
    setEditAllocName(w.name)
    setEditAllocDim(w.dimension)
    setEditSlices(w.slices?.length ? w.slices : [{ name: 'Slice 1', items: [] }])
    setEditOverrides({ ...(countryOverrides ?? {}) })
    // Editing is done in the widget itself, so it has to be on screen and the
    // settings panel out of the way.
    setVisible({ ...visibleRaw, [w.id]: true })
    setShowCustomise(false)
  }

  function handleEditDimChange(newDim: AllocDimension) {
    // Auto-update name only if it still matches the old dimension's default
    const oldDefault = DIM_DEFAULT_NAMES[editAllocDim]
    if (!editAllocName.trim() || editAllocName === oldDefault) {
      setEditAllocName(DIM_DEFAULT_NAMES[newDim])
    }
    // Ensure slices exist when switching to custom
    if (newDim === 'custom' && editSlices.length === 0) {
      setEditSlices([{ name: 'Slice 1', items: [] }])
    }
    setEditAllocDim(newDim)
  }

  function saveAllocEdit() {
    if (!editingAllocId) return
    setAllocWidgets(allocWidgets.map(w =>
      w.id === editingAllocId
        ? { ...w, name: editAllocName.trim() || w.name, dimension: editAllocDim, slices: editAllocDim === 'custom' ? editSlices : undefined }
        : w
    ))
    if (editAllocDim === 'country') {
      saveOverridesMutation.mutate(editOverrides)
    }
    setEditingAllocId(null)
  }

  // Slice helpers
  function addSlice() {
    setEditSlices([...editSlices, { name: `Slice ${editSlices.length + 1}`, items: [] }])
  }

  function removeSlice(idx: number) {
    setEditSlices(editSlices.filter((_, i) => i !== idx))
  }

  function renameSlice(idx: number, name: string) {
    setEditSlices(editSlices.map((s, i) => i === idx ? { ...s, name } : s))
  }

  function toggleSliceItem(sliceIdx: number, itemId: string) {
    setEditSlices(editSlices.map((s, i) => {
      if (i !== sliceIdx) return s
      const has = s.items.includes(itemId)
      return { ...s, items: has ? s.items.filter(t => t !== itemId) : [...s.items, itemId] }
    }))
  }

  function addAllocWidget(dim: AllocDimension) {
    const id = `alloc_${Date.now()}`
    const name = DIM_DEFAULT_NAMES[dim]
    const isCustom = dim === 'custom'
    const newWidget: AllocWidgetConfig = isCustom
      ? { id, name, dimension: dim, slices: [{ name: 'Slice 1', items: [] }] }
      : { id, name, dimension: dim }

    setAllocWidgets([...allocWidgets, newWidget])
    setOrder([...orderRaw, id])
    setVisible({ ...visibleRaw, [id]: true })

    // Country / Sector / Exchange derive their slices from the portfolio, so there
    // is nothing to configure — leave settings open so more can be added. Only a
    // custom widget needs the slice editor, which lives inside the widget card, so
    // that is the one case worth closing the panel for.
    if (isCustom) {
      setEditingAllocId(id)
      setEditAllocName(name)
      setEditAllocDim('custom')
      setEditSlices([{ name: 'Slice 1', items: [] }])
      setShowCustomise(false)
    }
  }

  function removeAllocWidget(id: string) {
    setAllocWidgets(allocWidgets.filter(w => w.id !== id))
    setOrder(orderRaw.filter(oid => oid !== id))
    const next = { ...visibleRaw }
    delete next[id]
    setVisible(next)
  }

  // ── Widget order / visibility ────────────────────────────────────────────
  const [orderRaw, setOrder] = useLocalStorage<string[]>('dash_order', DEFAULT_ORDER)
  const order = useMemo(() => {
    const allAllocIds = new Set(allocWidgets.map(w => w.id))
    const validFixed = new Set(Object.keys(FIXED_WIDGET_LABELS))
    const known = orderRaw.filter(id => validFixed.has(id) || allAllocIds.has(id))
    // Same validity test as `known`. Without it a default id whose widget config the
    // user doesn't have (their allocation widgets carry their own ids) is listed in
    // Settings as a bare id and renders nothing.
    const newIds = DEFAULT_ORDER.filter(
      id => !known.includes(id) && (validFixed.has(id) || allAllocIds.has(id)))
    // New widgets normally land at the bottom, which is wrong for perf_chart — it is
    // the headline chart and belongs on top. Without this a saved layout (everyone
    // who has ever opened the dashboard) would bury it under five other widgets and
    // it would look like the feature never shipped.
    const merged = [...known, ...newIds.filter(id => id !== 'perf_chart')]
    return newIds.includes('perf_chart') ? ['perf_chart', ...merged] : merged
  }, [orderRaw, allocWidgets])

  // User width overrides, keyed by widget id. Empty means "use the default span".
  const [spans, setSpans] = useLocalStorage<Record<string, number>>('dash_spans', {})
  const widthOf = useCallback(
    (id: string) => Math.max(spans[id] ?? spanOf(id), minSpanOf(id)), [spans])
  const setWidth = useCallback((id: string, span: number) => {
    setSpans({ ...spans, [id]: span })
  }, [spans, setSpans])

  const [visibleRaw, setVisible] = useLocalStorage<Record<string, boolean>>('dash_visible', DEFAULT_VISIBLE)
  const visible = useMemo(() => ({ ...visibleRaw }), [visibleRaw])

  const [statKeys, setStatKeysRaw] = useLocalStorage<StatKey[]>('dash_stats', DEFAULT_STATS)
  const VALID_STAT_KEYS = new Set(STAT_OPTIONS.map(o => o.key))
  const cleanedStatKeys = statKeys.filter(k => VALID_STAT_KEYS.has(k))
  const setStatKeys = setStatKeysRaw

  const [showCustomise, setShowCustomise] = useState(false)

  // ── Layout persistence ───────────────────────────────────────────────────
  const { data: remoteLayout } = useDashboardLayout()
  const saveLayout = useSaveDashboardLayout()
  const [layoutLoadedFromAccount, setLayoutLoadedFromAccount] = useState(false)

  useEffect(() => {
    if (!remoteLayout || layoutLoadedFromAccount) return
    if (remoteLayout.widget_order) setOrder(remoteLayout.widget_order as string[])
    if (remoteLayout.widget_visible) setVisible(remoteLayout.widget_visible as Record<string, boolean>)
    if (remoteLayout.stat_keys) setStatKeys(remoteLayout.stat_keys as StatKey[])
    // Definitions travel with the layout. Without this the saved order still named
    // widgets whose config only existed in one browser's localStorage, so they were
    // filtered out and appeared to have been deleted.
    if (remoteLayout.alloc_widgets) setAllocWidgets(remoteLayout.alloc_widgets as AllocWidgetConfig[])
    if (remoteLayout.widget_spans) setSpans(remoteLayout.widget_spans as Record<string, number>)
    setLayoutLoadedFromAccount(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteLayout])

  useEffect(() => {
    if (!layoutLoadedFromAccount) return
    saveLayout.mutate({
      widget_order: order, widget_visible: visible,
      stat_keys: statKeys, alloc_widgets: allocWidgets, widget_spans: spans,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, visible, statKeys, allocWidgets, spans, layoutLoadedFromAccount])

  // One-time migration. A layout saved before the hero and ledger existed still lists
  // net_worth, portfolio, cash, day_pl, total_return and so on, which would now print
  // twice. Strip those once, then never again — so deliberately re-adding one in
  // Customise sticks instead of being silently filtered away on every render.
  //
  // Gated on layoutLoadedFromAccount, and declared after it: the server's stat_keys land
  // in the effect above and would overwrite anything migrated on mount.

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
    ? mc.months.map((m, i) => ({
        month: m,
        end: mc.period_end?.[i] ?? '',
        change: mc.change[i],
        pct: mc.change_pct[i],
        source: mc.sources?.[i] ?? 'manual',
        // The final bar covers a month still in progress, so it is not comparable with
        // the completed ones and must never win "best" or "worst" on a part-month.
        mtd: mc.is_mtd?.[i] ?? false,
        // Labelled by the CLOSING date, which is how a net-worth sheet recorded on the
        // 1st files it: the row written on 1 May holds the change since 1 April, so it is
        // the "May" figure. Reconciling against that sheet is then a straight read-across.
        //
        // Labelling by closing date is only viable because the in-progress bar is named
        // separately: it also closes in the current month, so both would otherwise be
        // "Aug" — one holding July's change, which is exactly the collision that had
        // August reading -$9,473 while the month was up $23k.
        label: (mc.is_mtd?.[i] ?? false) ? 'MTD' : monthLabel(mc.period_end?.[i] ?? m),
      }))
    : []

  // On a phone the full history is not a chart, it is a smear: 66 bars in the ~285px of
  // plot a 375px screen leaves works out at 2px per bar with 0.7px gaps. The last 18
  // months at ~13px each is legible, and the whole series is still there on a wider
  // screen. Recomputed on resize so rotating the phone re-decides.
  const narrow = useIsNarrow()
  const mcVisible = useMemo(
    () => (narrow && mcData.length > 18 ? mcData.slice(-18) : mcData),
    [mcData, narrow],
  )

  // Biggest gain and biggest loss among completed months — of what is actually drawn, so
  // the annotation never points off-chart at a month the reader cannot see.
  const { bestIdx, worstIdx } = useMemo(() => {
    let b = -1, w = -1
    mcVisible.forEach((d, i) => {
      if (d.mtd) return
      if (b < 0 || d.change > mcVisible[b].change) b = i
      if (w < 0 || d.change < mcVisible[w].change) w = i
    })
    return { bestIdx: b, worstIdx: mcVisible[w]?.change < 0 ? w : -1 }
  }, [mcVisible])

  const holdingsData = portfolio
    ? [...portfolio]
        .filter(h => h.units > 0 && h.value_aud > 0)
        .sort((a, b) => b.value_aud - a.value_aud)
        .map(h => ({ name: h.ticker, value: h.value_aud, logo_url: h.logo_url }))
    : []

  // Available items for custom slice builder
  const availableItems = useMemo(() => {
    const items: { id: string; label: string; value: number }[] = []
    portfolio?.filter(h => h.units > 0 && h.value_aud > 0).forEach(h => {
      items.push({ id: h.ticker, label: h.ticker, value: h.value_aud })
    })
    if (bd?.cash && bd.cash > 0)  items.push({ id: '__CASH__',  label: 'Cash',  value: bd.cash })
    if (bd?.super && bd.super > 0) items.push({ id: '__SUPER__', label: 'Super', value: bd.super })
    return items
  }, [portfolio, bd])

  // ── Allocation data by dimension ─────────────────────────────────────────
  function getAllocData(cfg: AllocWidgetConfig): { name: string; value: number }[] {
    switch (cfg.dimension) {
      case 'country':
        return alloc
          ? Object.entries(alloc.countries).map(([name, v]) => ({ name, value: (v as { value: number }).value }))
          : []

      case 'sector': {
        if (!portfolio) return []
        const map: Record<string, number> = {}
        portfolio.filter(h => h.units > 0 && h.value_aud > 0).forEach(h => {
          const sector = h.sector as string
          let key: string
          if (sector) {
            key = sector
          } else {
            const name = ((h.name as string) ?? '').toLowerCase()
            key = (name.includes('etf') || name.includes('fund') || name.includes('index')) ? 'ETF / Fund' : 'Other'
          }
          map[key] = (map[key] ?? 0) + h.value_aud
        })
        return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
      }

      case 'exchange': {
        if (!portfolio) return []
        const map: Record<string, number> = {}
        portfolio.filter(h => h.units > 0 && h.value_aud > 0).forEach(h => {
          const key = (h.exchange as string) || 'Other'
          map[key] = (map[key] ?? 0) + h.value_aud
        })
        return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
      }

      case 'custom': {
        if (!cfg.slices?.length) return []
        return cfg.slices.map(slice => ({
          name: slice.name,
          value: slice.items.reduce((sum, id) => {
            if (id === '__CASH__')  return sum + (bd?.cash ?? 0)
            if (id === '__SUPER__') return sum + (bd?.super ?? 0)
            return sum + (portfolio?.find(h => h.ticker === id)?.value_aud ?? 0)
          }, 0),
        })).filter(d => d.value > 0)
      }
    }
  }

  // ── Stat values ──────────────────────────────────────────────────────────
  // Holdings basis, so these match the Portfolio table's Total row and the treemap.
  // total_return / total_return_pct are price+currency only and sat 1.71pp below the
  // table on the same screen, which is exactly the sort of mismatch this tab lost.
  const totalReturn = stats?.holding_return ?? 0
  const returnPct = stats?.holding_return_pct ?? 0

  function resolveStatCard(key: StatKey): { label: string; value: string; sub?: string; color?: string } {
    switch (key) {
      case 'net_worth':    return { label: 'Total Net Worth',   value: fmtCurrency(bd?.total ?? 0) }
      case 'portfolio':    return { label: 'Portfolio Value',   value: fmtCurrency(bd?.portfolio ?? 0), sub: `Return: ${fmtCurrencySigned(totalReturn)} (${fmtPct(returnPct)})`, color: totalReturn >= 0 ? '#10b981' : '#ef4444' }
      case 'super':        return { label: 'Superannuation',    value: fmtCurrency(bd?.super ?? 0) }
      case 'cash':         return { label: 'Cash',              value: fmtCurrency(bd?.cash ?? 0) }
      // Renamed from "Total Return" — it is market value less the cost of units still
      // held, i.e. unrealised only. The lifetime figure is 'total_all'.
      case 'total_return': return { label: 'Return',            value: fmtCurrencySigned(totalReturn), sub: 'on current holdings', color: totalReturn >= 0 ? '#10b981' : '#ef4444' }
      case 'return_pct':   return { label: 'Return (%)',        value: fmtPct(returnPct), sub: 'on cost of holdings', color: returnPct >= 0 ? '#10b981' : '#ef4444' }
      // sub carries the position's weight, not its own percentage again — the value
      // already prints the percentage, previously repeated at a second precision.
      case 'best':         return { label: 'Best Performer',    value: stats?.best_performer ?? '—', sub: 'largest gain on cost', color: '#10b981' }
      case 'worst':        return { label: 'Worst Performer',   value: stats?.worst_performer ?? '—', sub: 'largest loss on cost', color: '#ef4444' }
      case 'cost_basis': {
        const basis = stats?.cost_basis ?? 0
        return { label: 'Cost Basis', value: fmtCurrency(basis), sub: 'average cost, units held' }
      }
      case 'realised': {
        const r = stats?.realised_gain ?? 0
        return { label: 'Realised Gain', value: fmtCurrencySigned(r), sub: 'banked on sales, after cost', color: r >= 0 ? '#10b981' : '#ef4444' }
      }
      case 'total_all': {
        const t = stats?.total_return_all ?? 0
        return { label: 'Total Return (all)', value: fmtCurrencySigned(t), sub: 'unrealised + realised + income + franking', color: t >= 0 ? '#10b981' : '#ef4444' }
      }
      case 'cagr': {
        // Money-weighted (XIRR) over the real dated cash flows. The old CAGR here
        // divided by the cost of units still held and ignored sales and dividends
        // entirely, reading +4.0% where the money-weighted rate is +16.0%.
        const mwr = stats?.mwr_pct
        const ann = stats?.mwr_annualised ?? true
        const yrs = stats?.mwr_years ?? 0
        if (mwr == null) return { label: 'Return p.a.', value: '—', sub: 'not enough history' }
        return {
          label: ann ? 'Return p.a.' : 'Return to date',
          value: `${mwr >= 0 ? '+' : ''}${mwr.toFixed(1)}%`,
          sub: ann ? `money-weighted · over ${yrs.toFixed(1)} yrs` : `over ${yrs.toFixed(1)} yrs — not annualised`,
          color: mwr >= 0 ? '#10b981' : '#ef4444',
        }
      }
      case 'dividends': {
        const div = stats?.income_total ?? stats?.dividend_income ?? 0
        const fr = stats?.franking_total ?? 0
        return { label: 'Dividend Income', value: fmtCurrency(div), sub: fr > 0 ? `+${fmtCurrency(fr)} franking credits` : 'total received (AUD)', color: '#f59e0b' }
      }
      case 'ext_hours': {
        // Flips between pre-market and after-hours on its own, driven by Yahoo's
        // marketState. Covers US holdings only — yfinance has no ASX extended session,
        // so the percentage is against the US sleeve, not net worth.
        if (!ext || ext.covered === 0) {
          return { label: 'Pre / After Market', value: '—', sub: ext?.note ?? 'no extended-hours quotes' }
        }
        const up = ext.total_aud >= 0
        return {
          label: ext.label,
          value: `${up ? '+' : '−'}${fmtCurrency(ext.total_aud)}`,
          sub: `${up ? '+' : ''}${ext.pct.toFixed(2)}% of US holdings · ${ext.covered} of ${ext.total_holdings}`,
          color: up ? '#10b981' : '#ef4444',
        }
      }
      case 'income_fy': {
        const fy = stats?.income_fy ?? 0
        return { label: 'Income This FY', value: fmtCurrency(fy), sub: 'since 1 Jul', color: '#f59e0b' }
      }
      case 'daily_ath': {
        const athDate = stats?.daily_ath_date
          ? new Date(stats.daily_ath_date).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' })
          : undefined
        return { label: 'Best Day Ever', value: fmtCurrencySigned(stats?.daily_ath ?? 0), sub: athDate ? `on ${athDate}` : undefined, color: '#f59e0b' }
      }
      case 'day_pl': {
        const pl = stats?.day_pl ?? 0
        const plPct = stats?.day_pl_pct ?? 0
        return { label: "Today's P&L", value: fmtCurrencySigned(pl), sub: `${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%`, color: pl >= 0 ? '#10b981' : '#ef4444' }
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
      const oldIdx = order.indexOf(active.id as string)
      const newIdx = order.indexOf(over.id as string)
      setOrder(arrayMove(order, oldIdx, newIdx))
    }
  }

  function toggleWidget(id: string) {
    // A widget with no stored entry is treated as visible everywhere else, but
    // `!undefined` is `true` — so the first click on a newly added widget used to
    // set it visible (it already was) and appear to do nothing.
    const isVisible = visible[id] !== false
    setVisible({ ...visibleRaw, [id]: !isVisible })
  }

  function toggleStat(key: StatKey) {
    if (statKeys.includes(key)) {
      if (statKeys.length === 1) return
      setStatKeys(statKeys.filter(k => k !== key))
    } else {
      setStatKeys([...statKeys, key])
    }
  }

  function getWidgetLabel(id: string): string {
    if (id in FIXED_WIDGET_LABELS) return FIXED_WIDGET_LABELS[id as FixedWidgetId]
    return allocWidgets.find(w => w.id === id)?.name ?? id
  }

  // ── Widget renderers ─────────────────────────────────────────────────────
  const tooltipStyle = {
    contentStyle: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 },
    labelStyle: { color: '#94a3b8' },
    itemStyle: { color: '#e2e8f0' },
  }

  const ranges: Range[] = RANGES_TIME

  function renderAllocWidget(cfg: AllocWidgetConfig) {
    const isEditing = editingAllocId === cfg.id
    const data = getAllocData(cfg)

    return (
      <div className={CARD} style={CARD_BG}>
        {/* ── Header ── */}
        <div className="flex items-center justify-between mb-4 gap-2 min-w-0">
          {isEditing ? (
            <>
              <input
                value={editAllocName}
                onChange={e => setEditAllocName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && editAllocDim !== 'custom') saveAllocEdit(); if (e.key === 'Escape') setEditingAllocId(null) }}
                className="flex-1 bg-transparent text-sm font-medium text-white border-b border-indigo-500 outline-none min-w-0"
                autoFocus
              />
              <select
                value={editAllocDim}
                onChange={e => handleEditDimChange(e.target.value as AllocDimension)}
                className="bg-slate-800 text-xs text-slate-300 rounded px-1.5 py-0.5 border border-slate-600 outline-none shrink-0"
              >
                {Object.entries(ALLOC_DIMENSION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <button onClick={saveAllocEdit} className="text-emerald-400 hover:text-emerald-300 shrink-0" title="Save"><Check size={14} /></button>
              <button onClick={() => setEditingAllocId(null)} className="text-slate-500 hover:text-white shrink-0" title="Cancel"><X size={14} /></button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-300 truncate">{cfg.name}</p>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => startEditAlloc(cfg)} className="text-slate-600 hover:text-slate-300 transition-colors" title="Edit"><Pencil size={13} /></button>
                <button onClick={() => removeAllocWidget(cfg.id)} className="text-slate-700 hover:text-red-400 transition-colors" title="Remove widget"><Trash2 size={13} /></button>
                {/* Flip country/sector/exchange in place. Custom is excluded: it needs
                    slices defined, which is what the edit pencil is for. */}
                {cfg.dimension === 'custom' ? (
                  <span className="text-[10px] text-slate-600 px-1.5 py-0.5 rounded bg-slate-800/60">
                    {ALLOC_DIMENSION_LABELS[cfg.dimension]}
                  </span>
                ) : (
                  <select
                    value={cfg.dimension}
                    onChange={e => setAllocWidgets(allocWidgets.map(w =>
                      w.id === cfg.id ? { ...w, dimension: e.target.value as AllocDimension } : w))}
                    className="text-[10px] text-slate-400 px-1 py-0.5 rounded bg-slate-800/60 border border-transparent hover:border-slate-600 outline-none cursor-pointer"
                    title="Group by"
                  >
                    {(['country', 'sector', 'exchange'] as AllocDimension[]).map(d => (
                      <option key={d} value={d}>{ALLOC_DIMENSION_LABELS[d]}</option>
                    ))}
                  </select>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Custom slice editor ── */}
        {isEditing && editAllocDim === 'custom' && (
          <div className="mb-4 space-y-3">
            <p className="text-[11px] text-slate-500">
              Define each slice by name, then pick which holdings/accounts go into it.
            </p>
            {editSlices.map((slice, si) => (
              <div key={si} className="rounded-lg border border-slate-700 bg-slate-900/40 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    value={slice.name}
                    onChange={e => renameSlice(si, e.target.value)}
                    placeholder="Slice name"
                    className="flex-1 bg-transparent text-xs font-semibold text-white border-b border-slate-600 outline-none"
                  />
                  <button onClick={() => removeSlice(si)} className="text-slate-600 hover:text-red-400 shrink-0"><Trash2 size={11} /></button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {availableItems.length === 0 && (
                    <span className="text-[10px] text-slate-600">No holdings yet — sync prices first.</span>
                  )}
                  {availableItems.map(item => {
                    const selected = slice.items.includes(item.id)
                    const usedIn = editSlices
                      .filter((s, i) => i !== si && s.items.includes(item.id))
                      .map(s => s.name)
                    return (
                      <button
                        key={item.id}
                        onClick={() => toggleSliceItem(si, item.id)}
                        className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors font-medium ${
                          selected
                            ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                            : usedIn.length > 0
                              ? 'border-slate-700 text-slate-600 hover:border-slate-500 hover:text-slate-400'
                              : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'
                        }`}
                        title={`${fmtCurrency(item.value)}${usedIn.length ? ` · also in ${usedIn.join(', ')}` : ''}`}
                      >
                        {item.label}
                        {usedIn.length > 0 && !selected && <span className="ml-0.5 opacity-40">*</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            <button
              onClick={addSlice}
              className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              <Plus size={11} /> Add slice
            </button>
          </div>
        )}

        {/* ── Country override editor ── */}
        {isEditing && editAllocDim === 'country' && (
          <div className="mb-4 space-y-1">
            <p className="text-[11px] text-slate-500 mb-2">
              Override the auto-detected country per holding. Leave on "—" to keep the default.
            </p>
            {portfolio?.filter(h => h.units > 0).map(h => {
              const auto = exchangeToCountry(h.exchange as string)
              const override = editOverrides[h.ticker] ?? ''
              return (
                <div key={h.ticker} className="flex items-center gap-2 py-1.5 border-b border-slate-800/60 last:border-0">
                  <span className="text-xs font-medium text-slate-300 w-14 shrink-0">{h.ticker}</span>
                  <span className="text-[10px] text-slate-500 flex-1 truncate min-w-0">{h.name as string}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-slate-600">auto: <span className="text-slate-400">{auto}</span></span>
                    <select
                      value={override}
                      onChange={e => {
                        const val = e.target.value
                        const next = { ...editOverrides }
                        if (val) { next[h.ticker] = val } else { delete next[h.ticker] }
                        setEditOverrides(next)
                      }}
                      className={`bg-slate-800 text-xs rounded px-1.5 py-0.5 border outline-none ${override ? 'border-indigo-500 text-indigo-300' : 'border-slate-600 text-slate-400'}`}
                    >
                      <option value="">—</option>
                      {COUNTRY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Chart (hidden while editing custom) ── */}
        {(!isEditing || editAllocDim !== 'custom') && (
          data.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-10">
              {cfg.dimension === 'custom' && (!cfg.slices?.length || cfg.slices.every(s => s.items.length === 0))
                ? 'Click the pencil to define your slices.'
                : 'No data — sync prices first.'}
            </p>
          ) : (
            <DonutBreakdown data={data} size={160} />
          )
        )}
      </div>
    )
  }

  function renderWidget(id: string) {
    if (id.startsWith('alloc_')) {
      const cfg = allocWidgets.find(w => w.id === id)
      return cfg ? renderAllocWidget(cfg) : null
    }
    switch (id as FixedWidgetId) {
      case 'networth': {
        const bands = NW_BANDS.filter(b => activeLines.includes(b))
        const latest = nwData[nwData.length - 1]
        const gridColor = themeColors['--border'] ?? '#262d5c'
        const axisColor = themeColors['--text-muted'] ?? '#64748b'
        return (
          <div className={CARD + ' flex flex-col'} style={{ ...CARD_BG, height: FULL_WIDGET_H }}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-sm font-medium text-slate-300">Net Worth Timeline</p>
                <div className="flex gap-1 flex-wrap">
                  {NW_LINES.map(l => (
                    <button
                      key={l.key}
                      onClick={() => toggleLine(l.key)}
                      className={`px-2.5 py-0.5 text-xs rounded-full border font-medium transition-colors ${activeLines.includes(l.key) ? '' : 'border-[var(--border)] text-slate-600'}`}
                      // The band colours are tuned as fills — Super sits at lightness
                      // 0.40, which is legible as an area but not as 12px text. Border
                      // and tint use the true colour; the label is lifted toward white
                      // so every pill stays readable whatever the band is.
                      style={activeLines.includes(l.key)
                        ? {
                            borderColor: l.color,
                            background: `color-mix(in oklab, ${l.color} 18%, transparent)`,
                            color: `color-mix(in oklab, ${l.color} 62%, white)`,
                          }
                        : {}}
                    >{l.key}</button>
                  ))}
                </div>
              </div>
              {/* Range selector */}
              <RangeDial options={ranges} value={range} onChange={setRange} narrow={narrow} />
            </div>

            {latest && (
              <div className="flex items-baseline gap-2.5 mb-3">
                <span className="text-2xl font-semibold text-white tabular-nums">
                  {fmtCurrency(latest['Net Worth'])}
                </span>
                <span className="text-xs text-slate-500">now · {fmtDate(latest.date)}</span>
              </div>
            )}

            <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={nwData} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={gridColor} strokeDasharray="1 5" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: axisColor, fontSize: 11 }}
                  tickLine={false} axisLine={false}
                  interval="preserveStartEnd" minTickGap={48}
                  tickFormatter={d => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { month: 'short', year: '2-digit' })}
                />
                <YAxis
                  tick={{ fill: axisColor, fontSize: 11 }}
                  tickLine={false} axisLine={false} width={52}
                  // A stack is only honest anchored at zero. Return shows alone, where
                  // there is no stack to mislead, so let it fit its own range including
                  // the negative stretch.
                  domain={bands.length ? [0, 'auto'] : ['auto', 'auto']}
                  tickFormatter={v => '$' + (v / 1000).toFixed(0) + 'k'}
                />
                <Tooltip
                  cursor={{ stroke: axisColor, strokeDasharray: '3 3' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const order = ['Net Worth', 'Portfolio', 'Cash', 'Super', 'Return']
                    const rows = [...payload].sort(
                      (a, b) => order.indexOf(String(a.name)) - order.indexOf(String(b.name)))
                    return (
                      <div className="rounded-lg border border-[var(--border)] px-3 py-2 shadow-xl"
                        style={{ background: 'var(--bg-elevated)' }}>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
                          {fmtDate(String(label))}
                        </p>
                        {rows.map(p => (
                          <div key={String(p.name)} className="flex items-center gap-2 text-xs py-0.5">
                            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: p.color }} />
                            <span className="text-slate-400 flex-1">{p.name}</span>
                            <span className="text-white font-medium tabular-nums">
                              {fmtCurrency(Number(p.value))}
                            </span>
                          </div>
                        ))}
                      </div>
                    )
                  }}
                />

                {/* Composition, bottom-up. Hiding a band shrinks the fill but never
                    the Net Worth line, which is its own series. */}
                {bands.map(b => (
                  <Area key={b} type="monotone" dataKey={b} stackId="nw"
                    stroke="none" fill={nwColor(b)} fillOpacity={0.62} isAnimationActive={false} />
                ))}

                {activeLines.includes('Return') && (
                  <Line type="monotone" dataKey="Return" stroke={nwColor('Return')}
                    dot={false} strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} />
                )}
                {activeLines.includes('Net Worth') && (
                  <Line type="monotone" dataKey="Net Worth" stroke={nwColor('Net Worth')}
                    dot={false} strokeWidth={2.4} isAnimationActive={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--bg-card)' }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            </div>
          </div>
        )
      }

      case 'monthly':
        return (
          <div className={CARD + ' flex flex-col'} style={{ ...CARD_BG, height: FULL_WIDGET_H }}>
            {/* Stacks on a phone: side by side, the title wrapped to two lines and the
                meta to two more, eating a quarter of the card before the chart began. */}
            <div className="flex flex-col gap-0.5 mb-4 md:flex-row md:items-center md:justify-between">
              <p className="text-sm font-medium text-slate-300">Monthly Change</p>
              <div className="flex items-center gap-3 text-[10px] text-slate-600 whitespace-nowrap">
                <span>
                  {mcVisible.length} months{narrow && mcVisible.length < mcData.length ? ' (latest)' : ''}
                  <span className="hidden md:inline"> · best and worst annotated</span>
                </span>
                {mcVisible.some(d => d.mtd) && (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#10b981', opacity: 0.45 }} />
                    month-to-date
                  </span>
                )}
              </div>
            </div>
            {/* min-h-0 so the flex child can actually shrink and let the chart fill the card */}
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                {/* right margin carries the final bar's annotation: "MTD +$23k" is wider than a
                    bar, and at right: 12 it was clipped to "MTD +$23". */}
                <BarChart data={mcVisible} margin={{ top: 26, right: 46, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#64748b', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  {/* Sign before the symbol: the naive template renders -35000 as "$-35k". */}
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false}
                    tickFormatter={v => (v < 0 ? '−$' : '$') + Math.abs(v / 1000).toFixed(0) + 'k'} />
                  <Tooltip
                    cursor={{ fill: 'rgba(148, 163, 184, 0.10)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload as typeof mcVisible[0]
                      return (
                        <div style={{ ...tooltipStyle.contentStyle, padding: '8px 12px' }}>
                          <p className="text-slate-400 text-[11px]">
                            {d.mtd ? 'Month to date' : monthLabel(d.end)}
                          </p>
                          {/* The span, spelled out. A month name alone is ambiguous: a
                              spreadsheet written on the 1st files this under the closing
                              date, the chart labels it by the month it happened in. */}
                          {d.end && (
                            <p className="text-slate-500 text-[10px] mb-1.5">
                              {dayMonth(d.month)} → {d.mtd ? 'today' : dayMonth(d.end)}
                            </p>
                          )}
                          <p className="font-semibold text-sm" style={{ color: d.change >= 0 ? '#10b981' : '#ef4444' }}>
                            {fmtCurrencySigned(d.change)}
                          </p>
                          <p className="text-slate-500 text-[10px]">{d.pct >= 0 ? '+' : ''}{d.pct.toFixed(1)}%</p>
                          {d.source === 'auto' && <p className="text-indigo-400 text-[10px] mt-1">⚡ auto-snapshot</p>}
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="change" radius={4}>
                    {mcVisible.map((d, i) => (
                      <Cell key={i}
                        fill={d.change >= 0 ? '#10b981' : '#ef4444'}
                        // The in-progress month is drawn faded so a part-month total can't be
                        // mistaken for a finished one sitting next to 65 completed bars.
                        fillOpacity={d.mtd ? 0.45 : 1}
                        stroke={d.mtd ? (d.change >= 0 ? '#10b981' : '#ef4444')
                              : d.source === 'auto' ? '#818cf8' : 'transparent'}
                        strokeWidth={d.mtd ? 1.5 : d.source === 'auto' ? 1.5 : 0}
                        strokeDasharray={d.mtd ? '3 2' : undefined}
                      />
                    ))}
                    <LabelList
                      dataKey="change"
                      content={props => {
                        const { index: i, x, y, width: w, height: h } = props as unknown as
                          { index: number; x: number; y: number; width: number; height: number }
                        const d = mcVisible[i]
                        if (!d || (i !== bestIdx && i !== worstIdx && !d.mtd)) return null
                        const up = d.change >= 0
                        // Recharts reports a NEGATIVE height for downward bars, so y is the
                        // far edge rather than the top. Normalise before offsetting: without
                        // this the label sits partway up the bar it describes, and for a loss
                        // that means red text on a red bar. Its own "position=top/bottom"
                        // fares no better — it clips ~3px into the bar.
                        const top = Math.min(y, y + h), bottom = Math.max(y, y + h)
                        const ty = up ? top - 7 : bottom + 15
                        const colour = d.mtd ? '#e2e8f0' : up ? '#34d399' : '#f87171'
                        const text = (d.mtd ? 'MTD ' : '') +
                          (up ? '+' : '−') + '$' + Math.round(Math.abs(d.change) / 1000) + 'k'
                        // A backing plate, because an annotation is far wider than the bar it
                        // belongs to and will cross whatever tall neighbour sits beside it —
                        // "MTD +$23k" was landing on a full-height green bar and vanishing.
                        // Sized from character count: SVG text cannot be measured before it
                        // is laid out, and a slightly generous plate is harmless.
                        const tw = text.length * 6.4
                        return (
                          <g>
                            <rect
                              x={x + w / 2 - tw / 2 - 5} y={ty - 11}
                              width={tw + 10} height={15} rx={3}
                              fill="rgba(2, 6, 23, 0.82)"
                            />
                            <text x={x + w / 2} y={ty} textAnchor="middle"
                              fill={colour} fontSize={11} fontWeight={600}>
                              {text}
                            </text>
                          </g>
                        )
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )

      case 'perf_chart': {
        // Cumulative return on the SAME basis as the Holdings tab: price, currency and
        // a pro-rated share of dividends and franking on the units still held. NOT
        // time-weighted — TWR is the textbook way to race an index, but it produces a
        // different number from the one Holdings shows, and this app has spent its
        // whole life fixing exactly that kind of split. Consistency wins; the benchmark
        // is a reference line, not a like-for-like race, and the caption says so.
        const pdata = (perf?.dates ?? []).map((d, i) => ({
          date: d,
          you: perf!.portfolio[i],
          bench: perf!.benchmark[i] ?? null,
        }))
        const you = perf?.portfolio_return ?? 0
        const bench = perf?.benchmark_return
        const gridColor = themeColors['--border'] ?? '#262d5c'
        const axisColor = themeColors['--text-muted'] ?? '#64748b'
        return (
          <div className={CARD + ' flex flex-col'} style={{ ...CARD_BG, height: FULL_WIDGET_H }}>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
              <p className="text-sm font-medium text-slate-300">Performance</p>
              <div className="flex items-center gap-2 flex-wrap">
                <RangeDial options={PERF_RANGES} value={perfRange} onChange={setPerfRange} narrow={narrow} />
                {benchEdit === null ? (
                  <button onClick={() => setBenchEdit(benchmark)}
                    className="px-2 py-0.5 text-[11px] rounded-md font-semibold border border-[var(--border)] text-slate-300 hover:border-indigo-500"
                    title="Change benchmark">
                    {perf?.benchmark_symbol ?? benchmark}
                  </button>
                ) : (
                  <input
                    autoFocus value={benchEdit}
                    onChange={e => setBenchEdit(e.target.value.toUpperCase())}
                    onBlur={() => { if (benchEdit.trim()) setBenchmark(benchEdit.trim()); setBenchEdit(null) }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { if (benchEdit.trim()) setBenchmark(benchEdit.trim()); setBenchEdit(null) }
                      if (e.key === 'Escape') setBenchEdit(null)
                    }}
                    className="w-24 px-2 py-0.5 text-[11px] rounded-md bg-[var(--bg-elevated)] border border-indigo-500 text-white outline-none"
                    placeholder="IVV.AX"
                  />
                )}
              </div>
            </div>
            {/* Legend doubles as the readout, the way the reference does: the two
                numbers you actually came for, above the chart rather than buried in
                a tooltip you have to hunt for. */}
            <div className="flex items-center gap-4 text-xs mb-3 flex-wrap">
              <span className="text-slate-500">{pdata[pdata.length - 1]?.date ?? ''}</span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: '#10b981' }} />
                <span className="text-slate-400">Portfolio</span>
                <span className="font-semibold tabular-nums" style={{ color: you >= 0 ? '#10b981' : '#ef4444' }}>
                  {fmtPct(you)}
                </span>
              </span>
              {perf?.benchmark_available && bench != null && (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: '#818cf8' }} />
                  <span className="text-slate-400">{perf.benchmark_symbol}</span>
                  <span className="font-semibold tabular-nums text-slate-300">{fmtPct(bench)}</span>
                </span>
              )}
              {perf && !perf.benchmark_available && (
                <span className="text-[11px] text-amber-400">
                  no prices for {perf.benchmark_symbol} — run a sync
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mb-3 -mt-1">
              Return on what you hold — price, currency and dividends — the same figure as
              the Holdings tab.{perf?.benchmark_available && ` ${perf.benchmark_symbol} is a price-only index for reference; it excludes its own distributions.`}
            </p>
            {pdata.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-10">Not enough history yet.</p>
            ) : (
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={pdata} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="perfFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: axisColor, fontSize: 11 }}
                      tickLine={false} axisLine={false} minTickGap={narrow ? 64 : 40}
                      tickFormatter={(d: string) => {
                        const [y, m] = d.split('-')
                        return `${MONTHS[Number(m) - 1]} '${y.slice(2)}`
                      }} />
                    <YAxis tick={{ fill: axisColor, fontSize: 11 }}
                      tickLine={false} axisLine={false} width={narrow ? 38 : 52}
                      tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-card)', border: `1px solid ${gridColor}`, borderRadius: 8, fontSize: 12 }}
                      formatter={(v: unknown, n: unknown) =>
                        [fmtPct(v as number), n === 'you' ? 'Portfolio' : (perf?.benchmark_symbol ?? 'Benchmark')]}
                    />
                    <ReferenceLine y={0} stroke={axisColor} strokeDasharray="2 2" />
                    <Area type="monotone" dataKey="you" stroke="#10b981" strokeWidth={2}
                      fill="url(#perfFill)" dot={false} isAnimationActive={false} />
                    {perf?.benchmark_available && (
                      <Area type="monotone" dataKey="bench" stroke="#818cf8" strokeWidth={1.5}
                        fill="none" dot={false} isAnimationActive={false} />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )
      }

      case 'performance': {
        // Falls back to the portfolio's own figures until the range query resolves, so
        // the treemap never blanks out while switching scales.
        // 'Total' is holding_return_pct — identical to the Portfolio table's Return
        // column, so the tile and the table quote one number. The tile's AREA is
        // current value, so its figure covers current holdings only; the lifetime one,
        // which counts sold parcels, is the dashboard headline.
        // 'Today' needs no request at all: daily_change_pct is already on the holding.
        const perfByTicker = new Map((rangePerf ?? []).map(r => [r.ticker, r]))
        const tilePct = (h: Holding) =>
          allocRange === 'Today'
            ? h.daily_change_pct
            : (perfByTicker.get(h.ticker)?.return_pct ?? h.holding_return_pct)
        const treemapData = portfolio
          ? portfolio
              .filter(h => h.units > 0 && h.value_aud > 0)
              .map(h => ({
                name: h.ticker as string,
                size: h.value_aud as number,
                return_pct: tilePct(h),
                logo_url: h.logo_url as string,
              }))
          : []
        return (
          <div className={CARD + ' flex flex-col'} style={{ ...CARD_BG, height: FULL_WIDGET_H }}>
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <div className="flex items-baseline gap-2">
                <p className="text-sm font-medium text-slate-300">Allocation</p>
                <span className="text-[11px] text-slate-500">
                  {allocRange === 'Today' ? "today's move"
                    : allocRange === 'Max' ? 'since purchase'
                    : `${allocRange} price move`}
                </span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <RangeDial options={ALLOC_RANGES} value={allocRange} onChange={setAllocRange} narrow={narrow} />
                {!narrow && (
                  <div className="flex items-center gap-3 text-[10px] text-slate-500">
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#991b1b' }} />loss</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: '#15803d' }} />gain</span>
                    <span className="text-slate-600">size = weight</span>
                  </div>
                )}
              </div>
            </div>
            {treemapData.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-10">No holdings — run a sync first.</p>
            ) : (
              <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                  <Treemap
                    data={treemapData}
                    dataKey="size"
                    aspectRatio={4 / 3}
                    content={<TreemapTile />}
                    isAnimationActive={false}
                  />
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )
      }

      case 'holdings': {
        return (
          <div className={CARD + ' flex flex-col'} style={{ ...CARD_BG, height: FULL_WIDGET_H }}>
            <p className="text-sm font-medium text-slate-300 mb-4">Portfolio Holdings</p>
            {holdingsData.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-10">No holdings with prices — run a sync first.</p>
            ) : (
              <div className="flex-1 min-h-0">
                {/* Sized to fill the card's height (560 less padding and title),
                    since the two-column list now leaves the room to do it. */}
                <DonutBreakdown data={holdingsData} size={420} showLogos fill columns={2} />
              </div>
            )}
          </div>
        )
      }

      default: return null
    }
  }

  const visibleOrder = order.filter(id => visible[id] !== false)

  return (
    <div className="space-y-6">
      {/* Header */}
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
            <p className="text-xs text-slate-400 mb-2">Stat Cards <span className="text-slate-600">(pick any)</span></p>
            <div className="flex flex-wrap gap-2">
              {STAT_OPTIONS.map(opt => {
                const on = statKeys.includes(opt.key)
                return (
                  <button key={opt.key} onClick={() => toggleStat(opt.key)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${on ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300' : 'border-[#20264b] text-slate-400 hover:border-slate-500'}`}
                  >{opt.label}</button>
                )
              })}
            </div>
          </div>

          {/* Theme */}
          <div>
            <p className="text-xs text-slate-400 mb-2">Theme</p>
            <div className="flex gap-3 flex-wrap">
              {THEMES.map(t => {
                const active = customHue == null && theme === t.id
                const swatch = `oklch(0.660 ${t.ca} ${t.ha})`
                return (
                  <button key={t.id} onClick={() => setTheme(t.id)} title={t.label}
                    className="flex flex-col items-center gap-1.5 group">
                    <div className="w-7 h-7 rounded-full transition-all"
                      style={{
                        background: swatch,
                        outline: active ? `3px solid ${swatch}` : '3px solid transparent',
                        outlineOffset: '3px',
                      }} />
                    <span className={`text-[10px] ${active ? 'text-white' : 'text-slate-600'}`}>{t.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Custom hue — lightness is fixed in index.css, so any hue stays legible */}
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <span className="text-xs text-slate-400 shrink-0">Custom hue</span>
              <input
                type="range" min={0} max={360} step={1}
                value={customHue ?? (THEMES.find(t => t.id === theme)?.ha ?? 272)}
                onChange={e => setCustomHue(Number(e.target.value))}
                aria-label="Custom accent hue"
                className="flex-1 min-w-40 max-w-64 h-2 rounded-full appearance-none cursor-pointer"
                style={{
                  background: 'linear-gradient(90deg, oklch(.66 .15 0), oklch(.66 .15 60), oklch(.66 .15 120), oklch(.66 .15 180), oklch(.66 .15 240), oklch(.66 .15 300), oklch(.66 .15 360))',
                }}
              />
              {customHue != null && (
                <>
                  <span className="text-[11px] text-slate-400 tabular-nums w-9">{customHue}°</span>
                  <button onClick={() => setTheme(theme)} className="text-[11px] text-slate-500 hover:text-white">
                    Reset
                  </button>
                </>
              )}
            </div>
            {customHue != null && hueClash(customHue) && (
              <p className="text-[11px] mt-2 text-white font-medium">
                This hue sits beside {hueClash(customHue)} — the accent may read as a verdict rather than a button.
              </p>
            )}
          </div>

          {/* Widget visibility — every widget, fixed and allocation alike, in one place */}
          <div>
            <p className="text-xs text-slate-400 mb-2">
              Widgets <span className="text-slate-600">(click to show or hide)</span>
            </p>
            <div className="space-y-1.5">
              {order.map(id => {
                const shown = visible[id] !== false
                return (
                  <div key={id} className="flex items-center justify-between gap-3 flex-wrap">
                    <button onClick={() => toggleWidget(id)}
                      className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded-full border transition-colors ${shown ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300' : 'border-[var(--border)] text-slate-500 hover:text-slate-300'}`}
                    >
                      {shown ? <Eye size={11} /> : <EyeOff size={11} />}
                      {getWidgetLabel(id)}
                    </button>
                    {/* Width only bites at xl and above — below that every widget is
                        full width regardless, so offering the choice on a phone would
                        be a control that visibly does nothing. */}
                    <div className="hidden xl:flex gap-0.5">
                      {spanChoicesFor(id).map(c => (
                        <button key={c.span} onClick={() => setWidth(id, c.span)}
                          title={`${getWidgetLabel(id)} — ${c.label} width`}
                          className={`px-2 py-0.5 text-[11px] rounded-md font-medium transition-colors ${
                            widthOf(id) === c.span ? 'bg-[var(--accent)] text-white' : 'text-slate-500 hover:text-slate-300'}`}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-slate-600 mt-2">
              Drag the <GripVertical size={11} className="inline" /> handle on any widget to reorder.
              Widths apply on wide screens; everything stacks full width on a phone.
            </p>
          </div>

          {/* Allocation widgets — the only place they're created, edited or removed */}
          <div>
            <p className="text-xs text-slate-400 mb-2">Allocation Widgets</p>

            {/* Pick the breakdown up front. Country / Sector / Exchange are derived
                from your holdings and need no setup; Custom opens the slice editor. */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <span className="text-[11px] text-slate-600">Add:</span>
              {(Object.keys(ALLOC_DIMENSION_LABELS) as AllocDimension[]).map(dim => (
                <button
                  key={dim}
                  onClick={() => addAllocWidget(dim)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border border-[var(--border)] text-slate-300 hover:text-white transition-colors"
                  style={{ background: 'var(--bg-elevated)' }}
                  title={dim === 'custom' ? 'Define your own slices' : `Break down by ${ALLOC_DIMENSION_LABELS[dim].toLowerCase()}`}
                >
                  <Plus size={10} /> {ALLOC_DIMENSION_LABELS[dim]}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {allocWidgets.length === 0 && (
                <p className="text-xs text-slate-600 rounded-lg px-3 py-3 border border-dashed border-[var(--border)]">
                  None yet — add one to break your portfolio down however you like.
                </p>
              )}
              {allocWidgets.map(w => (
                <div key={w.id} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
                  <span className="flex-1 text-xs text-slate-300 truncate min-w-0">{w.name}</span>
                  <span className="text-[10px] text-slate-500 shrink-0 px-1.5 py-0.5 rounded bg-black/25">
                    {ALLOC_DIMENSION_LABELS[w.dimension]}
                  </span>
                  {visible[w.id] === false && (
                    <span className="text-[10px] text-slate-600 shrink-0">hidden</span>
                  )}
                  <button onClick={() => startEditAlloc(w)} className="text-slate-500 hover:text-white shrink-0" title="Edit"><Pencil size={11} /></button>
                  <button onClick={() => removeAllocWidget(w.id)} className="text-slate-600 hover:text-red-400 shrink-0" title="Remove"><Trash2 size={11} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Hero: net worth, its composition, and the lifetime return ledger. These own
          net_worth / portfolio / super / cash / day_pl and total_all / total_return /
          realised / dividends, so those are absent from DEFAULT_STATS below — still
          selectable in Customise for anyone who wants them as cards too. */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={CARD + ' xl:col-span-2'} style={CARD_BG}>
          <NetWorthHero
            netWorth={(bd?.portfolio ?? 0) + (bd?.super ?? 0) + (bd?.cash ?? 0)}
            portfolio={bd?.portfolio ?? 0}
            superAnn={bd?.super ?? 0}
            cash={bd?.cash ?? 0}
            dayPl={stats?.day_pl ?? 0}
          />
        </div>
        <div className={CARD} style={CARD_BG}>
          <ReturnLedger
            total={stats?.total_return_all ?? 0}
            unrealised={stats?.total_return ?? 0}
            realised={stats?.realised_gain ?? 0}
            income={stats?.income_total ?? 0}
            franking={stats?.franking_total ?? 0}
          />
        </div>
      </div>

      {/* Stat cards + prices-as-of timestamp */}
      <div>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {cleanedStatKeys.map(key => {
            const c = resolveStatCard(key)
            return <StatCard key={key} {...c} />
          })}
        </div>
        {syncStatuses && syncStatuses.length > 0 && (() => {
          const holdings = portfolio?.map(h => h.symbol) ?? []
          // "Last updated" means when we last successfully fetched, which is the
          // question being asked — an as-of DATE never moves when you press refresh,
          // so the control looked broken even when it worked. The real defect was
          // that the intraday refresh path wrote prices without stamping sync_log;
          // with that fixed this clock actually moves. The newest price DATE is the
          // tooltip, since that is the secondary fact.
          const relevant = syncStatuses.filter(s => holdings.includes(s.symbol) && s.last_synced)
          if (!relevant.length) return null
          const latest = relevant.reduce((a, b) => (a.last_synced > b.last_synced ? a : b))
          const mins = Math.floor((Date.now() - new Date(latest.last_synced).getTime()) / 60000)
          const label = mins < 1 ? 'just now'
            : mins < 60 ? `${mins}m ago`
            : mins < 1440 ? `${Math.floor(mins / 60)}h ago`
            : `${Math.floor(mins / 1440)}d ago`
          const stale = mins > 120
          const asOf = relevant.reduce((a, b) => (a.actual_to > b.actual_to ? a : b)).actual_to
          return (
            <p className="text-[11px] mt-2 text-right" style={{ color: stale ? '#f59e0b' : '#475569' }}
               title={`Newest price ${asOf} · checked ${new Date(latest.last_synced).toLocaleString('en-AU')}`}>
              {stale ? '⚠ ' : ''}Updated {label}
            </p>
          )
        })()}
      </div>

      {/* Sortable widgets */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleOrder} strategy={verticalListSortingStrategy}>
          {/* items-start stops the grid stretching every card in a row to match the
              tallest one — that was leaving ~400px of dead space under the short
              widgets. Each card is now its own height. */}
          <div className="grid grid-cols-1 xl:grid-cols-6 gap-4 items-start">
            {visibleOrder.map(id => (
              <SortableWidget key={id} id={id} span={widthOf(id)}>
                {renderWidget(id)}
              </SortableWidget>
            ))}
          </div>
        </SortableContext>
      </DndContext>

    </div>
  )
}
