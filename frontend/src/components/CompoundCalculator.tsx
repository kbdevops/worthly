import { useState, useMemo } from 'react'
import { useBreakdown } from '../hooks/useApi'
import { BALANCE_METRICS, balanceValue, metricLabel } from '../lib/metrics'
import type { BalanceMetricId } from '../lib/metrics'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'

/** Periods per year. Deposit and compound frequency are chosen independently, the way
 *  MoneySmart's calculator does it — you can pay in fortnightly against an account
 *  that compounds monthly. */
const DEPOSIT_FREQ = {
  Weekly: 52, Fortnightly: 26, Monthly: 12, Quarterly: 4, Annually: 1,
} as const
const COMPOUND_FREQ = {
  Daily: 365, Monthly: 12, Quarterly: 4, Annually: 1,
} as const

type DepositFreq = keyof typeof DEPOSIT_FREQ
type CompoundFreq = keyof typeof COMPOUND_FREQ

export interface CompoundInputs {
  initial: number
  deposit: number
  depositFreq: DepositFreq
  compoundFreq: CompoundFreq
  years: number
  ratePct: number
}

export interface CompoundYear {
  year: number
  balance: number
  initial: number    // flat — the opening deposit, never changes
  regular: number    // cumulative regular deposits, initial excluded
  deposits: number   // initial + regular
  yearInterest: number  // interest earned in THIS year alone, not cumulative
  interest: number   // balance - deposits
}

/** Nominal annual rate compounded n times a year is not the rate you actually earn.
 *  10% compounded monthly returns 10.47%, because each month's interest itself earns
 *  interest for the rest of the year. This is the number MoneySmart labels "effective
 *  interest rate", and it's the honest one to compare accounts on. */
export function effectiveRate(ratePct: number, compoundFreq: CompoundFreq): number {
  const n = COMPOUND_FREQ[compoundFreq]
  return ((1 + ratePct / 100 / n) ** n - 1) * 100
}

/** Balance at the end of each year.
 *
 *  Stepped one compounding period at a time: interest is applied, then the deposits
 *  belonging to that period are added. Deposits land at period END (an ordinary
 *  annuity), so a contribution earns nothing in the period it arrives — the
 *  conservative reading, and the one that makes deposit-frequency == compound-frequency
 *  agree exactly with the textbook FV formula.
 *
 *  When the two frequencies differ, deposits per period is fractional (fortnightly
 *  into monthly compounding = 26/12 = 2.167 per month). Spreading them evenly is an
 *  approximation of a few dollars over decades, and vastly closer than forcing the
 *  user to pick one frequency for both.
 */
export function projectCompound(input: CompoundInputs): CompoundYear[] {
  const { initial, deposit, depositFreq, compoundFreq, years, ratePct } = input
  const cpy = COMPOUND_FREQ[compoundFreq]
  const dpy = DEPOSIT_FREQ[depositFreq]
  const periodRate = ratePct / 100 / cpy
  const depositsPerPeriod = dpy / cpy

  // Year 0 is kept in the data — the summary cards and any caller reading rows[0] rely
  // on the opening state existing — but it is dropped from the chart, where a bar of
  // pure deposit with nothing compounded yet just shifts every real year one place right.
  const rows: CompoundYear[] = [
    { year: 0, balance: initial, initial, regular: 0, deposits: initial,
      interest: 0, yearInterest: 0 },
  ]
  let balance = initial
  let paidIn = initial
  let prevInterest = 0

  for (let y = 1; y <= years; y++) {
    for (let p = 0; p < cpy; p++) {
      balance *= 1 + periodRate
      const added = deposit * depositsPerPeriod
      balance += added
      paidIn += added
    }
    const interest = balance - paidIn
    rows.push({
      year: y,
      balance,
      initial,
      regular: paidIn - initial,
      deposits: paidIn,
      interest,
      // The step in cumulative interest, which is what "what did this year earn me"
      // means once deposits are still arriving — balance growth would also count the
      // money you just paid in, which is not compounding.
      yearInterest: interest - prevInterest,
    })
    prevInterest = interest
  }
  return rows
}

const money = (n: number) =>
  '$' + Math.round(n).toLocaleString('en-AU')
const moneyCompact = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}m`
  if (a >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${Math.round(n)}`
}

function StrategyTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { payload: CompoundYear }[]
  label?: number | string
}) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  const Row = ({ k, v, bold }: { k: string; v: string; bold?: boolean }) => (
    <div className={`flex justify-between gap-8 ${bold ? 'font-semibold pt-1.5 mt-1' : ''}`}
      style={bold ? { borderTop: '1px solid var(--border)' } : undefined}>
      <span style={{ color: bold ? 'var(--text-primary)' : 'var(--text-muted)' }}>{k}</span>
      <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{v}</span>
    </div>
  )
  return (
    <div className="rounded-lg px-3 py-2.5 text-xs"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex justify-between gap-8 mb-1.5">
        <span style={{ color: 'var(--text-primary)' }}>
          After {label} {Number(label) === 1 ? 'year' : 'years'}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>Your strategy</span>
      </div>
      <Row k="Initial deposit" v={money(r.initial)} />
      <Row k="Regular deposits" v={money(r.regular)} />
      <Row k={`Interest in year ${r.year}`} v={'+' + money(r.yearInterest)} />
      <Row k="Total interest" v={money(r.interest)} />
      <Row k="Total" v={money(r.balance)} bold />
    </div>
  )
}

function Field({ label, children, hint }: {
  label: string; children: React.ReactNode; hint?: string
}) {
  return (
    <div className="min-w-0">
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  )
}

const INPUT_CLASS =
  'w-full px-3 py-2 text-sm rounded-lg outline-none focus:border-indigo-500 transition-colors'
const INPUT_STYLE = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
} as const

/** Compound interest projection, mirroring moneysmart.gov.au's calculator.
 *
 *  Still a what-if — it writes nothing back, and the seed buttons COPY a balance rather
 *  than binding to it. A live-bound opening figure would quietly redraw the projection
 *  every time the market moved, so a scenario you set up on Monday would answer a
 *  different question on Friday. Click to fill, then type over it freely. */
export default function CompoundCalculator() {
  const { data: bd } = useBreakdown()
  const [initial, setInitial] = useState(260000)
  // Which balances the opening figure was seeded from. Tracked explicitly rather than
  // inferred by comparing the field to each amount: once they combine, several
  // different selections can produce the same total, and two of them summing to a third
  // by coincidence would light up the wrong pills.
  const [seeds, setSeeds] = useState<BalanceMetricId[]>([])
  const [deposit, setDeposit] = useState(2500)
  const [depositFreq, setDepositFreq] = useState<DepositFreq>('Monthly')
  const [compoundFreq, setCompoundFreq] = useState<CompoundFreq>('Monthly')
  const [years, setYears] = useState(50)
  const [ratePct, setRatePct] = useState(10)

  const rows = useMemo(
    () => projectCompound({ initial, deposit, depositFreq, compoundFreq, years, ratePct }),
    [initial, deposit, depositFreq, compoundFreq, years, ratePct],
  )
  const final = rows[rows.length - 1]
  // Year 0 is the opening deposit before anything has compounded — a bar of pure
  // principal that earns nothing and pushes every real year one column right. The
  // summary cards still read the full series; only the chart drops it.
  const chartRows = useMemo(() => rows.slice(1), [rows])
  const eff = effectiveRate(ratePct, compoundFreq)

  // Caps match MoneySmart's, and are enforced on the value rather than only on the
  // input's max attribute — typing past a max still sets state in every browser.
  const clamp = (v: number, lo: number, hi: number) =>
    Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : lo

  /** Add or remove a balance from the opening figure, keeping Net Worth exclusive.
   *  Deselecting everything leaves the amount alone rather than zeroing the field —
   *  clearing the pills is undoing the shortcut, not asking to start from nothing. */
  function toggleSeed(id: BalanceMetricId) {
    const next: BalanceMetricId[] = id === 'networth'
      ? (seeds.includes('networth') ? [] : ['networth'])
      : (() => {
          const rest = seeds.filter(x => x !== 'networth')
          return rest.includes(id) ? rest.filter(x => x !== id) : [...rest, id]
        })()
    setSeeds(next)
    if (next.length) {
      const total = next.reduce((sum, m) => sum + (balanceValue(m, bd) ?? 0), 0)
      setInitial(clamp(Math.round(total), 0, 1e9))
    }
  }

  return (
    <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Compound Interest Calculator
        </h3>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          a what-if — nothing here changes your portfolio
        </span>
      </div>

      {/* Seed the opening figure from real balances. They add up, so Portfolio + Cash +
          Super is a valid selection — but Net Worth is exactly those three summed, so it
          is exclusive: combining it with any leg would count that leg twice. Picking it
          clears the others and picking any other clears it. */}
      {bd && (
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-[11px] shrink-0" style={{ color: 'var(--text-muted)' }}>
            Start from
          </span>
          {BALANCE_METRICS.map(id => {
            const amount = balanceValue(id, bd)
            if (amount == null) return null
            const on = seeds.includes(id)
            return (
              <button key={id} type="button"
                onClick={() => toggleSeed(id)}
                title={id === 'networth'
                  ? `Set the initial deposit to ${money(amount)} — net worth already includes cash and super`
                  : `${on ? 'Remove' : 'Add'} ${metricLabel(id)} (${money(amount)})`}
                className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors tabular-nums ${
                  on ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300'
                     : 'border-[var(--border)] text-slate-400 hover:border-slate-500 hover:text-slate-200'}`}
              >{metricLabel(id)} <span className="opacity-60">{moneyCompact(amount)}</span></button>
            )
          })}
          {seeds.length > 1 && (
            <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
              = {money(initial)}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        <Field label="Initial deposit">
          <input type="number" min={0} step={1000} value={initial}
            onChange={e => { setSeeds([]); setInitial(clamp(Number(e.target.value), 0, 1e9)) }}
            className={INPUT_CLASS} style={INPUT_STYLE} />
        </Field>
        <Field label="Regular deposit">
          <input type="number" min={0} step={100} value={deposit}
            onChange={e => setDeposit(clamp(Number(e.target.value), 0, 1e7))}
            className={INPUT_CLASS} style={INPUT_STYLE} />
        </Field>
        <Field label="Deposit frequency">
          <select value={depositFreq} onChange={e => setDepositFreq(e.target.value as DepositFreq)}
            className={INPUT_CLASS} style={INPUT_STYLE}>
            {Object.keys(DEPOSIT_FREQ).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Compound frequency">
          <select value={compoundFreq} onChange={e => setCompoundFreq(e.target.value as CompoundFreq)}
            className={INPUT_CLASS} style={INPUT_STYLE}>
            {Object.keys(COMPOUND_FREQ).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="Number of years" hint="max 50">
          <input type="number" min={1} max={50} step={1} value={years}
            onChange={e => setYears(clamp(Math.round(Number(e.target.value)), 1, 50))}
            className={INPUT_CLASS} style={INPUT_STYLE} />
        </Field>
        <Field label="Annual interest rate (%)" hint="max 20%">
          <input type="number" min={0} max={20} step={0.1} value={ratePct}
            onChange={e => setRatePct(clamp(Number(e.target.value), 0, 20))}
            className={INPUT_CLASS} style={INPUT_STYLE} />
        </Field>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-elevated)' }}>
          <div className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>Effective interest rate</div>
          <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{eff.toFixed(2)}%</div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {ratePct.toFixed(2)}% compounded {compoundFreq.toLowerCase()}
          </div>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-elevated)' }}>
          <div className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>Balance after {years}y</div>
          <div className="text-xl font-bold text-emerald-400">{money(final.balance)}</div>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-elevated)' }}>
          <div className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>Total deposits</div>
          <div className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{money(final.deposits)}</div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {money(initial)} start + {money(final.deposits - initial)} added
          </div>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-elevated)' }}>
          <div className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>Total interest</div>
          <div className="text-xl font-bold text-indigo-400">{money(final.interest)}</div>
          <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {final.deposits > 0 ? `${(final.interest / final.deposits * 100).toFixed(0)}% of what you paid in` : '—'}
          </div>
        </div>
      </div>

      {/* Stacked bars, one per year: the floor is what you put in and everything above
          it is interest. A single balance line hides the crossover, which is the whole
          point of the exercise. */}
      <div style={{ height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows} margin={{ top: 4, right: 8, left: 4, bottom: 18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="year" tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              tickLine={false} axisLine={false} minTickGap={16}
              label={{ value: 'Years', position: 'insideBottom', offset: -14,
                       fill: 'var(--text-muted)', fontSize: 11 }} />
            <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
              tickLine={false} axisLine={false} width={54}
              tickFormatter={(v: number) => moneyCompact(v)} />
            <Tooltip cursor={{ fill: 'rgba(148,163,184,0.08)' }} content={<StrategyTooltip />} />
            <Legend verticalAlign="top" align="right" height={22}
              wrapperStyle={{ fontSize: 11, paddingBottom: 6 }} />
            <Bar dataKey="initial" name="Initial deposit" stackId="s" fill="#6366f1" isAnimationActive={false} />
            <Bar dataKey="regular" name="Regular deposits" stackId="s" fill="#818cf8" isAnimationActive={false} />
            <Bar dataKey="interest" name="Total interest" stackId="s" fill="#10b981" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
