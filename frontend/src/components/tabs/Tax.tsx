import { useState, useMemo } from 'react'
import { useCGT, useTaxIncome, useTaxSettings, useSaveTaxSettings, useTaxLock, useSetTaxLock } from '../../hooks/useApi'
import { fmtCurrencySigned, fmtCurrency, fmtDate } from '../../lib/utils'

/** Australian financial years, generated so the list can't silently go stale. */
function fyOptions() {
  const now = new Date()
  // FY labelled by its ENDING year: FY2027 = 1 Jul 2026 - 30 Jun 2027.
  const currentFyEnd = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear()
  const out = []
  for (let end = currentFyEnd; end >= currentFyEnd - 7; end--) {
    out.push({ label: `FY ${end}`, from: `${end - 1}-07-01`, to: `${end}-06-30` })
  }
  out.push({ label: 'Custom', from: '', to: '' })
  return out
}

const TH = 'px-3 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap'
const TD = 'px-3 py-3 text-sm whitespace-nowrap tabular-nums'
const CARD = 'rounded-xl p-5 border border-[var(--border)]'
const CARD_BG = { background: 'var(--bg-card)' }

const METHODS: { key: 'fifo' | 'lifo' | 'hifo'; label: string; hint: string }[] = [
  { key: 'fifo', label: 'FIFO', hint: 'Oldest parcels sold first. A common default, but the ATO lets you identify specific parcels — whatever you report here must match what you actually claim.' },
  { key: 'lifo', label: 'LIFO', hint: 'Newest parcels sold first. You must be able to identify these specific parcels to the ATO.' },
  { key: 'hifo', label: 'HIFO', hint: 'Highest-cost parcels first, which minimises the reported gain. Legitimate only if you genuinely identify those parcels.' },
]

const ENTITIES: { key: string; label: string; note: string }[] = [
  { key: 'individual', label: 'Individual / Trust', note: '50% CGT discount' },
  { key: 'smsf', label: 'SMSF', note: '33⅓% discount' },
  { key: 'company', label: 'Company', note: 'no discount' },
]

export default function Tax() {
  const FY_OPTIONS = useMemo(fyOptions, [])
  // Default to the last COMPLETED financial year — the one you'd actually be filing.
  const [fyIdx, setFyIdx] = useState(1)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [priorLosses, setPriorLosses] = useState('')

  const { data: settings } = useTaxSettings()
  const saveSettings = useSaveTaxSettings()
  const { data: lockInfo } = useTaxLock()
  const { lock, unlock } = useSetTaxLock()
  const method = settings?.allocation_method ?? 'fifo'
  const entity = settings?.entity_type ?? 'individual'

  const selected = FY_OPTIONS[fyIdx]
  const isCustom = selected.label === 'Custom'
  const from = isCustom ? customFrom : selected.from
  const to = isCustom ? customTo : selected.to
  const enabled = !!(from && to)

  const pl = priorLosses.trim() === '' ? undefined : Math.max(0, Number(priorLosses) || 0)
  const { data: cgt, isLoading, isError } = useCGT(from, to, method, enabled, pl)
  const { data: income } = useTaxIncome(from, to, enabled)

  const set = (patch: { entity_type?: string; allocation_method?: string }) =>
    saveSettings.mutate({ entity_type: entity, allocation_method: method, ...patch })

  const discountPct = cgt ? `${(cgt.discount_rate * 100).toFixed(cgt.discount_rate === 1 / 3 ? 2 : 0)}%` : '—'

  return (
    <div className="space-y-6">
      {/* ── Controls ─────────────────────────────────────────────────────── */}
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
              <button key={m.key} title={m.hint} onClick={() => set({ allocation_method: m.key })}
                className="px-3 py-2 text-xs font-medium transition-all"
                style={method === m.key ? { background: 'var(--accent)', color: '#fff' }
                                        : { background: 'var(--bg-card)', color: '#94a3b8' }}
              >{m.label}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Tax Entity</label>
          <select value={entity} onChange={e => set({ entity_type: e.target.value })}
            className="py-2 px-3 rounded-lg text-sm bg-[var(--bg-card)] border border-[var(--border)] text-slate-300 focus:outline-none focus:border-indigo-500">
            {ENTITIES.map(x => <option key={x.key} value={x.key}>{x.label} — {x.note}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1" title="Prior-year net capital losses to bring into this year">
            Carried-forward losses
          </label>
          <input type="number" min="0" step="0.01" placeholder={cgt ? String(cgt.prior_losses_available) : '0.00'}
            value={priorLosses} onChange={e => setPriorLosses(e.target.value)}
            className="py-2 px-3 rounded-lg text-sm w-40 bg-[var(--bg-card)] border border-[var(--border)] text-slate-300 focus:outline-none focus:border-indigo-500" />
        </div>
      </div>
      <p className="text-xs text-slate-500 -mt-3">{METHODS.find(m => m.key === method)?.hint}</p>

      {/* ── Sale allocation lock ──────────────────────────────────────────
          Parcel selection is recomputed on every request, so changing the method
          silently rewrites an already-lodged year AND shifts the leftover parcels into
          every later year. Locking freezes which parcels each disposal consumed. */}
      <div className={CARD + ' flex flex-wrap items-center gap-3 justify-between'} style={CARD_BG}>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white">
            Sale allocations {lockInfo?.locked_disposals ? 'locked' : 'not locked'}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {lockInfo?.locked_disposals
              ? `${lockInfo.locked_disposals} disposal${lockInfo.locked_disposals === 1 ? '' : 's'} frozen up to ${fmtDate(lockInfo.locked_to || '')}. Changing the method no longer affects these — or the cost base they hand to later years.`
              : 'Changing the parcel method right now rewrites every year, including ones you have already lodged. Lock a year once you have filed it.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {to && (
            <button
              onClick={() => lock.mutate({ to, method })}
              disabled={lock.isPending}
              className="px-3 py-1.5 text-xs rounded-lg font-medium disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {lock.isPending ? 'Locking…' : `Lock up to ${selected.label === 'Custom' ? to : selected.label}`}
            </button>
          )}
          {!!lockInfo?.locked_disposals && (
            <button
              onClick={() => { if (confirm('Unlock all sale allocations? Already-lodged years will start moving with the method again.')) unlock.mutate(undefined) }}
              className="px-3 py-1.5 text-xs rounded-lg border border-[var(--border)] text-slate-400 hover:text-white"
            >Unlock</button>
          )}
        </div>
      </div>

      {/* Anything the calculation couldn't account for. */}
      {cgt && cgt.warnings.length > 0 && (
        <div className="rounded-xl p-4 border" style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.35)' }}>
          <p className="text-xs font-semibold mb-1" style={{ color: '#f59e0b' }}>Check these before filing</p>
          {cgt.warnings.map((w, i) => <p key={i} className="text-xs text-amber-200/80">{w}</p>)}
        </div>
      )}

      {isLoading && <p className="text-slate-400 text-sm">Calculating…</p>}
      {isError && <p className="text-sm text-red-400">Couldn't load the tax calculation. Check the backend is running.</p>}
      {!enabled && <p className="text-sm text-slate-500">Pick a from and to date to run the report.</p>}

      {/* ── Capital gains ────────────────────────────────────────────────── */}
      {cgt && (
        <>
          <div>
            <p className="text-sm font-semibold text-white mb-3">Capital gains</p>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
              {[
                { label: 'Gross gains', value: fmtCurrency(cgt.gross_gains), color: '#10b981',
                  sub: `${fmtCurrency(cgt.discounted_gains)} discountable` },
                { label: 'Gross losses', value: cgt.gross_losses > 0 ? `−${fmtCurrency(cgt.gross_losses)}` : fmtCurrency(0), color: '#ef4444',
                  sub: `${fmtCurrency(cgt.losses_applied)} applied` },
                { label: `${discountPct} CGT discount`, value: `−${fmtCurrency(cgt.cgt_discount)}`, color: 'var(--accent)',
                  sub: entity === 'company' ? 'companies get no discount' : 'on parcels held > 12 months' },
                cgt.net_capital_loss > 0 && cgt.net_gain === 0
                  ? { label: 'Net capital LOSS', value: `−${fmtCurrency(cgt.net_capital_loss)}`, color: '#ef4444', sub: 'carries forward to later years' }
                  : { label: 'Net capital gain', value: fmtCurrency(cgt.net_gain), color: '#10b981', sub: 'taxable amount, not tax owed' },
              ].map(c => (
                <div key={c.label} className={CARD} style={CARD_BG}>
                  <p className="text-xs text-slate-400 mb-1">{c.label}</p>
                  <p className="text-2xl font-bold tabular-nums" style={{ color: c.color }}>{c.value}</p>
                  {c.sub && <p className="text-[11px] text-slate-500 mt-1">{c.sub}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* Reconciliation — every card above must be traceable to these lines. */}
          <div className={CARD} style={CARD_BG}>
            <p className="text-xs uppercase tracking-wider text-slate-400 mb-3">How the net gain is built</p>
            {[
              ['Discountable gains (held > 12 months)', cgt.discounted_gains],
              ['Non-discountable gains', cgt.non_discounted_gains],
              ...(cgt.distribution_gains_discounted ? [['  of which trust distributions', cgt.distribution_gains_discounted] as [string, number]] : []),
              ['Current-year losses applied', -cgt.losses_applied],
              ...(cgt.prior_losses_applied ? [['Prior-year losses applied', -cgt.prior_losses_applied] as [string, number]] : []),
              [`${discountPct} discount`, -cgt.cgt_discount],
            ].map(([label, v]) => (
              <div key={label as string} className="flex justify-between text-xs py-1.5 border-t border-[var(--border)] tabular-nums">
                <span className="text-slate-400">{label}</span>
                <span className={(v as number) < 0 ? 'text-red-400' : 'text-slate-200'}>{fmtCurrencySigned(v as number)}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm py-2 border-t-2 border-[var(--border)] font-semibold tabular-nums">
              <span className="text-white">Net capital gain</span>
              <span style={{ color: '#10b981' }}>{fmtCurrency(cgt.net_gain)}</span>
            </div>
            {cgt.losses_carried_forward > 0 && (
              <p className="text-[11px] text-amber-400/80 mt-2">
                {fmtCurrency(cgt.losses_carried_forward)} of losses could not be absorbed and carries forward to later income years.
              </p>
            )}
            {cgt.tax_deferred_distributions > 0 && (
              <p className="text-[11px] text-slate-500 mt-1">
                {fmtCurrency(cgt.tax_deferred_distributions)} of tax-deferred distributions reduce your cost base rather than being assessable.
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Taxable income ──────────────────────────────────────────────── */}
      {income && (
        <div>
          <p className="text-sm font-semibold text-white mb-3">Taxable income (dividends &amp; distributions)</p>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              { label: 'Assessable income', value: fmtCurrency(income.assessable_income), color: '#f59e0b', sub: 'gross + franking credits' },
              { label: 'Franking credits', value: fmtCurrency(income.franking_credits), color: 'var(--accent)', sub: 'claimable as a tax offset' },
              { label: 'Foreign income', value: fmtCurrency(income.foreign_income), color: '#06b6d4', sub: `${fmtCurrency(income.foreign_tax_offsets)} foreign tax offset` },
              { label: 'Net cash received', value: fmtCurrency(income.net_cash), color: '#94a3b8', sub: 'after withholding' },
            ].map(c => (
              <div key={c.label} className={CARD} style={CARD_BG}>
                <p className="text-xs text-slate-400 mb-1">{c.label}</p>
                <p className="text-2xl font-bold tabular-nums" style={{ color: c.color }}>{c.value}</p>
                <p className="text-[11px] text-slate-500 mt-1">{c.sub}</p>
              </div>
            ))}
          </div>
          {!income.components_entered && (
            <p className="text-[11px] text-amber-400/80 mt-3">
              No AMIT component breakdown entered. Australian ETF distributions (VAS, NDQ, IVV) include
              capital gains and tax-deferred amounts that belong in the CGT section rather than as income —
              until you enter them from your annual tax statements, this treats the whole distribution as income.
            </p>
          )}
        </div>
      )}

      {/* ── Disposals ───────────────────────────────────────────────────── */}
      {cgt && (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={CARD_BG}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ background: 'var(--bg-elevated)' }}>
                <tr>
                  <th className={TH}>Sold</th><th className={TH}>Acquired</th><th className={TH}>Held</th>
                  <th className={TH}>Ticker</th><th className={TH}>Units</th>
                  <th className={TH}>Proceeds (AUD)</th><th className={TH}>Cost (AUD)</th>
                  <th className={TH}>Gain/Loss</th><th className={TH}>Discounted</th>
                </tr>
              </thead>
              <tbody>
                {cgt.gains.map((d, i) => {
                  const days = Math.round(
                    (new Date(d.date + 'T00:00:00').getTime() - new Date(d.acquired_date + 'T00:00:00').getTime()) / 86400000)
                  return (
                    <tr key={i} className="border-t border-[var(--border)] hover:bg-white/5">
                      <td className={TD + ' text-slate-400'}>{fmtDate(d.date)}</td>
                      <td className={TD + ' text-slate-500'}>{fmtDate(d.acquired_date)}</td>
                      <td className={TD + ' text-slate-500'}>{days}d</td>
                      <td className={TD + ' font-medium text-white'}>{d.ticker}</td>
                      <td className={TD + ' text-slate-300'}>{d.units}</td>
                      <td className={TD + ' text-slate-300'}>{fmtCurrency(d.proceeds)}</td>
                      <td className={TD + ' text-slate-300'}>{fmtCurrency(d.cost)}</td>
                      {/* fmtCurrencySigned, not fmtCurrency — the latter strips the sign
                          with Math.abs, which rendered every capital loss as a gain. */}
                      <td className={TD + ' font-medium ' + (d.gain >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {d.gain >= 0 ? '+' : ''}{fmtCurrencySigned(d.gain)}
                      </td>
                      <td className={TD}>
                        {d.discount_eligible && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-indigo-500/20 text-indigo-400">{discountPct} off</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {cgt.gains.length === 0 && (
              <div className="text-center py-12 text-slate-500 text-sm">No disposals in this period</div>
            )}
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-500 leading-relaxed">
        Amounts are AUD, converted at the exchange rate on each transaction date. Cost bases include
        brokerage. <strong className="text-slate-400">Net capital gain is a taxable amount, not tax
        payable.</strong> This is a calculation aid, not tax advice — the parcel method and any AMIT
        component figures must match what you actually report, so confirm with a registered tax agent
        before lodging.
      </p>
    </div>
  )
}
