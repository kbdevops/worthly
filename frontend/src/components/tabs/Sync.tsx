import { useState, useEffect } from 'react'
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, Unlink } from 'lucide-react'
import {
  useSyncStatus, useSync,
  useIbkrCredentials, useSaveIbkrCredentials, useDeleteIbkrCredentials,
  useIbkrPreview, useIbkrStaged, useIbkrImport, useIbkrClearStaged,
} from '../../hooks/useApi'
import { fmtDate, fmtCurrency } from '../../lib/utils'
import type { SyncResult, IbkrPreviewJob, IbkrImportResult } from '../../types'

function IbkrSyncCard() {
  const { data: creds } = useIbkrCredentials()
  const saveCreds = useSaveIbkrCredentials()
  const deleteCreds = useDeleteIbkrCredentials()
  const configured = creds?.configured ?? false

  const preview = useIbkrPreview()
  const doImport = useIbkrImport()
  const clearStaged = useIbkrClearStaged()
  const { data: staged } = useIbkrStaged(configured)

  const [editing, setEditing] = useState(false)
  const [token, setToken] = useState('')
  const [queryId, setQueryId] = useState('')
  const [previewJob, setPreviewJob] = useState<IbkrPreviewJob | null>(null)
  const [result, setResult] = useState<IbkrImportResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const candidates = staged?.candidates ?? []

  // Default the ticks to the genuinely new trades only. Anything already imported, or
  // that collides with a hand-entered row, starts unticked — those are the two cases
  // where importing has a consequence beyond adding a row, so they should be a
  // deliberate choice rather than the default. Keyed on fetched_at so a fresh preview
  // resets the selection but re-renders in between don't stomp on the user's ticks.
  useEffect(() => {
    setSelected(new Set(candidates.filter(c => c.status === 'new').map(c => c.external_id)))
  }, [staged?.fetched_at])                                          // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit() {
    setToken('')
    setQueryId(creds?.query_id ?? '')
    setEditing(true)
  }

  function handleSaveCreds() {
    if (!token.trim() || !queryId.trim()) return
    saveCreds.mutate({ flex_token: token.trim(), query_id: queryId.trim() }, {
      onSuccess: () => { setEditing(false); setToken('') },
    })
  }

  function handleDisconnect() {
    if (!confirm('Disconnect IBKR? Trades already imported will stay, but syncing will stop until you reconnect.')) return
    deleteCreds.mutate()
  }

  async function handleFetch() {
    setResult(null)
    setPreviewJob(null)
    setPreviewJob(await preview.mutateAsync())
  }

  async function handleImport() {
    const ids = [...selected]
    if (!ids.length) return
    // Named explicitly because it deletes rows. The count comes from the candidates
    // actually ticked, not from the whole flagged set.
    const replacing = candidates.filter(c => selected.has(c.external_id) && (c.status === 'manual_duplicate' || c.status === 'near_duplicate'))
    if (replacing.length && !confirm(
      `Import ${ids.length} trade(s)?\n\n${replacing.length} of them will REPLACE a manual entry, ` +
      `deleting your hand-typed row:\n` +
      replacing.map(c => `  • ${c.trade.ticker} ${c.trade.date} — ${c.trade.units} @ ${c.trade.price}`).join('\n')
    )) return
    setResult(await doImport.mutateAsync(ids))
    setPreviewJob(null)
  }

  const toggle = (id: string) => setSelected(s => {
    const next = new Set(s)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
    new:               { label: 'New',              fg: '#10b981', bg: 'rgba(16,185,129,0.12)' },
    already_imported:  { label: 'Already imported', fg: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
    manual_duplicate:  { label: 'Replaces manual',  fg: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    // Red, not amber: this is the case that silently double-counts if waved through,
    // and it reads as 'new' to the eye because the dates differ.
    near_duplicate:    { label: 'Same trade, different date', fg: '#f87171', bg: 'rgba(248,113,113,0.14)' },
  }

  return (
    <div className="rounded-xl border border-[var(--border)] p-5" style={{ background: 'var(--bg-card)' }}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold text-white">Interactive Brokers</p>
        {configured && !editing && (
          <button onClick={handleDisconnect} className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-400">
            <Unlink size={12} /> Disconnect
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Fetch trade executions from your IBKR Flex query, then choose which to import. Nothing
        is written until you pick.
      </p>

      {!configured || editing ? (
        <div className="space-y-3 max-w-sm">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Flex Token</label>
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder={configured ? 'Re-enter to change' : 'Flex Web Service token'}
              className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--bg-elevated)] border border-[var(--border)] text-slate-200 placeholder-slate-600 focus:outline-none"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Query ID</label>
            <input
              value={queryId}
              onChange={e => setQueryId(e.target.value)}
              placeholder="Flex Query ID"
              className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--bg-elevated)] border border-[var(--border)] text-slate-200 placeholder-slate-600 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveCreds}
              disabled={saveCreds.isPending || !token.trim() || !queryId.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
            >
              {saveCreds.isPending ? 'Saving…' : 'Connect'}
            </button>
            {editing && (
              <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white">
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleFetch}
            disabled={preview.isPending}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
          >
            <RefreshCw size={14} className={preview.isPending ? 'spin' : ''} />
            {preview.isPending ? 'Fetching…' : candidates.length ? 'Re-fetch from IBKR' : 'Fetch Trades'}
          </button>
          <button onClick={startEdit} className="text-xs text-slate-500 hover:text-slate-300">
            Update credentials
          </button>
          <span className="text-xs text-slate-500">
            {creds?.last_synced ? `Last imported ${new Date(creds.last_synced).toLocaleString('en-AU')}` : 'Nothing imported yet'}
          </span>
        </div>
      )}

      {previewJob?.status === 'error' && (
        <div className="mt-4 rounded-lg p-3 text-sm text-red-300" style={{ background: 'rgba(239,68,68,0.1)' }}>
          {previewJob.error}
        </div>
      )}

      {previewJob?.status === 'done' && previewJob.summary && candidates.length === 0 && (
        <div className="mt-4 rounded-lg p-3 text-sm text-slate-300" style={{ background: 'rgba(148,163,184,0.1)' }}>
          The query returned no trades to review.
          {previewJob.summary.skipped_options > 0 && <> {previewJob.summary.skipped_options} options trade(s) skipped (not supported).</>}
          {Object.entries(previewJob.summary.skipped_currency).map(([cur, n]) => (
            <span key={cur}> {n} trade(s) in {cur} skipped (unsupported currency).</span>
          ))}
        </div>
      )}

      {/* ── Review list ─────────────────────────────────────────────────────── */}
      {candidates.length > 0 && (
        <div className="mt-4 rounded-lg border border-[var(--border)] overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 flex-wrap"
               style={{ background: 'var(--bg-elevated)' }}>
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-xs font-semibold text-slate-300">
                {candidates.length} trade{candidates.length === 1 ? '' : 's'} from IBKR
              </p>
              {(['near_duplicate', 'manual_duplicate', 'new', 'already_imported'] as const).map(s =>
                staged!.counts[s] > 0 && (
                  <span key={s} className="text-[11px] px-1.5 py-0.5 rounded font-medium"
                        style={{ color: STATUS[s].fg, background: STATUS[s].bg }}>
                    {staged!.counts[s]} {STATUS[s].label.toLowerCase()}
                  </span>
                ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setSelected(new Set(candidates.map(c => c.external_id)))}
                      className="text-xs text-slate-400 hover:text-white">All</button>
              <span className="text-slate-600">·</span>
              <button onClick={() => setSelected(new Set())}
                      className="text-xs text-slate-400 hover:text-white">None</button>
            </div>
          </div>

          <div className="divide-y divide-[var(--border)] max-h-96 overflow-y-auto">
            {candidates.map(c => {
              const st = STATUS[c.status]
              const on = selected.has(c.external_id)
              return (
                <label key={c.external_id}
                       className="flex items-start gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.02]">
                  <input type="checkbox" checked={on} onChange={() => toggle(c.external_id)}
                         className="mt-0.5 accent-indigo-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white">{c.trade.ticker}</span>
                      <span className={`text-xs font-medium ${c.trade.action === 'sell' ? 'text-red-400' : 'text-emerald-400'}`}>
                        {c.trade.action.toUpperCase()}
                      </span>
                      <span className="text-xs text-slate-400 tabular-nums">
                        {c.trade.units} @ {c.trade.price} {c.trade.currency}
                      </span>
                      <span className="text-xs text-slate-500">{fmtDate(c.trade.date)}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded font-medium"
                            style={{ color: st.fg, background: st.bg }}>{st.label}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                      {fmtCurrency(Math.abs(c.trade.value))} AUD · fx {c.trade.exch_rate} · brokerage {c.trade.brokerage}
                    </p>
                    {/* IBKR's figures beside yours, so a collision is a comparison rather
                        than an assertion that the two disagree. */}
                    {c.match && (
                      <p className="text-[11px] mt-1 tabular-nums"
                         style={{ color: c.status === 'near_duplicate' ? '#f87171'
                                : c.status === 'manual_duplicate' ? '#fbbf24' : '#94a3b8' }}>
                        {c.status === 'already_imported' ? 'Existing IBKR row' : 'Your manual row'} #{c.match.id}
                        {' '}on <strong>{fmtDate(c.match.date)}</strong>:
                        {' '}{c.match.units} @ {c.match.price} · fx {c.match.exch_rate}
                        {' · '}{fmtCurrency(Math.abs(c.match.value))} AUD
                        {c.match.date !== c.trade.date && <> — IBKR says <strong>{fmtDate(c.trade.date)}</strong></>}
                        {c.status !== 'already_imported' && on && <strong> — will be deleted</strong>}
                      </p>
                    )}
                  </div>
                </label>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap border-t border-[var(--border)]">
            <button
              onClick={handleImport}
              disabled={doImport.isPending || selected.size === 0}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
            >
              {doImport.isPending ? 'Importing…' : `Import ${selected.size} selected`}
            </button>
            <button
              onClick={() => { if (confirm('Discard this review list? Nothing has been imported.')) clearStaged.mutate() }}
              className="text-xs text-slate-500 hover:text-slate-300"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {result?.ok && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg p-3 text-sm text-emerald-300 flex items-start gap-2"
               style={{ background: 'rgba(16,185,129,0.1)' }}>
            <CheckCircle size={15} className="mt-0.5 shrink-0" />
            <span>
              {result.imported} trade{result.imported === 1 ? '' : 's'} imported.
              {result.price_sync_results && result.price_sync_results.length > 0 && (
                <> Also synced prices for {result.price_sync_results.filter(r => r.ok).map(r => r.symbol).join(', ')}
                {result.price_sync_results.some(r => !r.ok) && <>
                  {' '}(failed: {result.price_sync_results.filter(r => !r.ok).map(r => r.symbol).join(', ')})
                </>}.</>
              )}
            </span>
          </div>
          {result.replaced_manual.length > 0 && (
            <div className="rounded-lg p-3 border" style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.3)' }}>
              <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Manual entries replaced
              </p>
              {result.replaced_manual.map(r => (
                <p key={r.external_id} className="text-xs text-amber-200">
                  {r.ticker} on {fmtDate(r.date)} — your manual row #{r.deleted_txn_id} was deleted in favour of IBKR's.
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const TH = 'px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap'
const TD = 'px-4 py-3 text-sm whitespace-nowrap'

// A symbol is "stale" if nothing has even attempted to sync it in the last 20h —
// wider than the 2x/day background schedule (roughly every 15h) so a normal gap
// between runs doesn't get flagged, only an actually missed cycle.
const STALE_HOURS = 20

function hoursSince(iso: string | null): number | null {
  if (!iso) return null
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60)
}

export default function Sync() {
  const { data: status = [], refetch } = useSyncStatus()
  const sync = useSync()
  const [lastResults, setLastResults] = useState<SyncResult[] | null>(null)

  const handleSync = async (force?: boolean) => {
    setLastResults(null)
    const res = await sync.mutateAsync(force)
    setLastResults(res.results || [])
    refetch()
  }

  const failing = status.filter(s => s.last_error)
  const stale = status.filter(s => {
    const h = hoursSince(s.last_attempt)
    return h != null && h > STALE_HOURS
  })
  const mostRecentAttempt = status.reduce<string | null>((latest, s) => {
    if (!s.last_attempt) return latest
    return !latest || s.last_attempt > latest ? s.last_attempt : latest
  }, null)

  const healthy = status.length > 0 && failing.length === 0 && stale.length === 0

  return (
    <div className="space-y-6">
      <IbkrSyncCard />

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => handleSync(true)} disabled={sync.isPending}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
          <RefreshCw size={14} className={sync.isPending ? 'spin' : ''} />
          {sync.isPending ? 'Syncing…' : 'Sync All (Force)'}
        </button>
        <button onClick={() => handleSync(false)} disabled={sync.isPending}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-300 border border-[var(--border)] hover:border-[var(--border-hover)] disabled:opacity-60">
          <RefreshCw size={14} />
          Sync Missing Only
        </button>
      </div>

      {/* Health banner — this is the thing that was missing: a background sync
          already runs twice a day, but there was previously no way to tell whether
          it actually worked without checking server logs. */}
      {status.length > 0 && (
        <div className="rounded-xl p-4 border flex items-start gap-3"
          style={{
            background: healthy ? 'rgba(16,185,129,0.08)' : 'rgba(245,158,11,0.08)',
            borderColor: healthy ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)',
          }}>
          {healthy
            ? <CheckCircle size={18} className="text-emerald-400 mt-0.5 shrink-0" />
            : <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />}
          <div className="text-sm">
            {healthy ? (
              <p className="text-emerald-300 font-medium">
                All {status.length} symbols synced OK
                {mostRecentAttempt && <> — last attempt {new Date(mostRecentAttempt).toLocaleString('en-AU')}</>}
              </p>
            ) : (
              <div className="space-y-0.5">
                {failing.length > 0 && (
                  <p className="text-amber-300 font-medium">
                    {failing.length} symbol{failing.length > 1 ? 's' : ''} failing: {failing.map(s => s.symbol).join(', ')}
                  </p>
                )}
                {stale.length > 0 && (
                  <p className="text-amber-300 font-medium">
                    {stale.length} symbol{stale.length > 1 ? 's' : ''} haven't synced in over {STALE_HOURS}h: {stale.map(s => s.symbol).join(', ')} — the background sync may not be running
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Result of the sync that was just triggered from this tab */}
      {lastResults && lastResults.length > 0 && (
        <div className="rounded-xl p-4 border border-[var(--border)]" style={{ background: 'var(--bg-card)' }}>
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-2">Last run</p>
          <div className="flex flex-wrap gap-2">
            {lastResults.map(r => (
              <span key={r.symbol} title={r.message}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                style={r.ok
                  ? { background: 'rgba(16,185,129,0.1)', color: '#34d399' }
                  : { background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
                {r.ok ? <CheckCircle size={12} /> : <XCircle size={12} />}
                {r.symbol}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-card)' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ background: 'var(--bg-elevated)' }}>
              <tr>
                <th className={TH}>Symbol</th><th className={TH}>Status</th><th className={TH}>Records</th>
                <th className={TH}>From</th><th className={TH}>To</th>
                <th className={TH}>Last Synced</th><th className={TH}>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {status.map(s => {
                const isStale = (hoursSince(s.last_attempt) ?? 0) > STALE_HOURS
                return (
                  <tr key={s.symbol} className="border-t border-[var(--border)] hover:bg-white/5">
                    <td className={TD + ' font-medium text-white'}>{s.symbol}</td>
                    <td className={TD}>
                      {s.last_error ? (
                        <span className="flex items-center gap-1.5 text-red-400" title={s.last_error}>
                          <XCircle size={14} /> Failed
                        </span>
                      ) : isStale ? (
                        <span className="flex items-center gap-1.5 text-amber-400" title="Hasn't attempted a sync recently">
                          <AlertTriangle size={14} /> Stale
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-emerald-400">
                          <CheckCircle size={14} /> OK
                        </span>
                      )}
                    </td>
                    <td className={TD + ' text-slate-300'}>{s.record_count?.toLocaleString()}</td>
                    <td className={TD + ' text-slate-400'}>{fmtDate(s.actual_from)}</td>
                    <td className={TD + ' text-slate-400'}>{fmtDate(s.actual_to)}</td>
                    <td className={TD + ' text-slate-400'}>{s.last_synced ? new Date(s.last_synced).toLocaleString('en-AU') : '—'}</td>
                    <td className={TD}>
                      {s.has_meta
                        ? <CheckCircle size={16} className="text-emerald-400" />
                        : <XCircle size={16} className="text-slate-500" />
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {status.length === 0 && (
            <div className="text-center py-12 text-slate-500 text-sm">
              No price data cached yet. Click Sync All to fetch prices.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}