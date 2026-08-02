import { useState } from 'react'
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, Unlink } from 'lucide-react'
import {
  useSyncStatus, useSync,
  useIbkrCredentials, useSaveIbkrCredentials, useDeleteIbkrCredentials, useIbkrSync,
} from '../../hooks/useApi'
import { fmtDate, fmtCurrency } from '../../lib/utils'
import type { SyncResult, IbkrSyncJob } from '../../types'

function IbkrSyncCard() {
  const { data: creds } = useIbkrCredentials()
  const saveCreds = useSaveIbkrCredentials()
  const deleteCreds = useDeleteIbkrCredentials()
  const ibkrSync = useIbkrSync()

  const [editing, setEditing] = useState(false)
  const [token, setToken] = useState('')
  const [queryId, setQueryId] = useState('')
  const [lastJob, setLastJob] = useState<IbkrSyncJob | null>(null)

  const configured = creds?.configured ?? false

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

  async function handleSync() {
    setLastJob(null)
    const res = await ibkrSync.mutateAsync()
    setLastJob(res)
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
        Pull trade executions from your IBKR Flex Web Service query and import them as transactions.
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
            onClick={handleSync}
            disabled={ibkrSync.isPending}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
          >
            <RefreshCw size={14} className={ibkrSync.isPending ? 'spin' : ''} />
            {ibkrSync.isPending ? 'Syncing…' : 'Sync Trades'}
          </button>
          <button onClick={startEdit} className="text-xs text-slate-500 hover:text-slate-300">
            Update credentials
          </button>
          <span className="text-xs text-slate-500">
            {creds?.last_synced ? `Last synced ${new Date(creds.last_synced).toLocaleString('en-AU')}` : 'Never synced'}
          </span>
        </div>
      )}

      {lastJob?.status === 'error' && (
        <div className="mt-4 rounded-lg p-3 text-sm text-red-300" style={{ background: 'rgba(239,68,68,0.1)' }}>
          {lastJob.error}
        </div>
      )}

      {lastJob?.status === 'done' && lastJob.results && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg p-3 text-sm text-emerald-300" style={{ background: 'rgba(16,185,129,0.1)' }}>
            {lastJob.results.trades_processed} trade{lastJob.results.trades_processed === 1 ? '' : 's'} imported/updated.
            {lastJob.results.skipped_options > 0 && <> {lastJob.results.skipped_options} options trade(s) skipped (not supported).</>}
            {Object.entries(lastJob.results.skipped_currency).map(([cur, n]) => (
              <span key={cur}> {n} trade(s) in {cur} skipped (unsupported currency).</span>
            ))}
            {lastJob.price_sync_results && lastJob.price_sync_results.length > 0 && (
              <> Also synced prices for {lastJob.price_sync_results.filter(r => r.ok).map(r => r.symbol).join(', ')}
              {lastJob.price_sync_results.some(r => !r.ok) && <>
                {' '}(failed: {lastJob.price_sync_results.filter(r => !r.ok).map(r => r.symbol).join(', ')})
              </>}.</>
            )}
          </div>

          {lastJob.duplicate_warnings && lastJob.duplicate_warnings.length > 0 && (
            <div className="rounded-lg p-3 border" style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.3)' }}>
              <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Possible duplicates — review before keeping both
              </p>
              <div className="space-y-1.5">
                {lastJob.duplicate_warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-200">
                    <span className="font-medium">{w.ticker}</span> on {fmtDate(w.date)} — {w.units} units @ {fmtCurrency(w.price)} exists
                    as both a manual entry and this IBKR import. Check Holdings and delete the manual one if it's the same trade.
                  </p>
                ))}
              </div>
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