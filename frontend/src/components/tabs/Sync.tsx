import { RefreshCw, CheckCircle, XCircle } from 'lucide-react'
import { useSyncStatus, useSync } from '../../hooks/useApi'
import { fmtDate } from '../../lib/utils'

const TH = 'px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap'
const TD = 'px-4 py-3 text-sm whitespace-nowrap'

export default function Sync() {
  const { data: status = [], refetch } = useSyncStatus()
  const sync = useSync()

  const handleSync = async (force?: boolean) => {
    await sync.mutateAsync(force)
    refetch()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
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

      <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-card)' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ background: 'var(--bg-elevated)' }}>
              <tr>
                <th className={TH}>Symbol</th><th className={TH}>Records</th>
                <th className={TH}>From</th><th className={TH}>To</th>
                <th className={TH}>Last Synced</th><th className={TH}>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {status.map(s => (
                <tr key={s.symbol} className="border-t border-[var(--border)] hover:bg-white/5">
                  <td className={TD + ' font-medium text-white'}>{s.symbol}</td>
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
              ))}
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
