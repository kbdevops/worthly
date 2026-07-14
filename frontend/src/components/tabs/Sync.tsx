import { useState } from 'react'
import { RefreshCw, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import { useSyncStatus, useSync } from '../../hooks/useApi'
import { fmtDate } from '../../lib/utils'
import type { SyncResult } from '../../types'

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