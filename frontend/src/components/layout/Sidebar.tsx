import { LayoutDashboard, Briefcase, Calculator, Award, RefreshCw, Coins, Database, TrendingUp } from 'lucide-react'
import type { TabId } from '../../App'
import { useSync } from '../../hooks/useApi'
import { getStoredUser } from '../../lib/auth'
import { cn } from '../../lib/utils'

const ICONS: Record<TabId, React.ReactNode> = {
  dashboard:  <LayoutDashboard size={16} />,
  holdings:   <Briefcase size={16} />,
  compounder: <TrendingUp size={16} />,
  tax:        <Calculator size={16} />,
  dividends:  <Coins size={16} />,
  milestones: <Award size={16} />,
  sync:       <Database size={16} />,
}

const NAV_GROUPS: { label?: string; ids: TabId[] }[] = [
  { ids: ['dashboard', 'holdings'] },
  { label: 'Tools', ids: ['compounder', 'tax', 'dividends', 'milestones'] },
  { ids: ['sync'] },
]

interface Props {
  tabs: { id: TabId; label: string }[]
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  open: boolean
}

export default function Sidebar({ tabs, activeTab, onTabChange, open }: Props) {
  const sync = useSync()
  const user = getStoredUser()
  const tabMap = Object.fromEntries(tabs.map(t => [t.id, t]))

  return (
    <aside
      className={cn(
        'fixed top-0 left-0 z-30 h-full w-60 flex flex-col transition-transform duration-300',
        'lg:relative lg:translate-x-0 lg:flex',
        open ? 'translate-x-0' : '-translate-x-full'
      )}
      style={{ background: 'var(--bg-elevated)', borderRight: '1px solid var(--border)' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
        >
          <span className="text-white text-xs font-bold tracking-tight">W</span>
        </div>
        <span className="font-semibold text-white text-sm tracking-tight">Worthly</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-4 overflow-y-auto py-2">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.ids.map(id => {
                const tab = tabMap[id]
                if (!tab) return null
                const active = activeTab === id
                return (
                  <button
                    key={id}
                    onClick={() => onTabChange(id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all',
                      active
                        ? 'bg-white/[0.07] text-white'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                    )}
                  >
                    <span
                      className="shrink-0 transition-colors"
                      style={active ? { color: 'var(--accent)' } : {}}
                    >
                      {ICONS[id]}
                    </span>
                    {tab.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: user + sync */}
      <div className="px-4 py-4 border-t border-[var(--border)] space-y-3">
        {user && (
          <div className="flex items-center gap-2.5 px-1">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
            >
              {user.email[0].toUpperCase()}
            </div>
            <span className="text-xs text-slate-400 truncate">{user.email}</span>
          </div>
        )}
        <button
          onClick={() => sync.mutate(false)}
          disabled={sync.isPending}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 border border-[var(--border)] hover:border-slate-600 bg-white/[0.03] hover:bg-white/[0.06] transition-all disabled:opacity-40"
        >
          <RefreshCw size={12} className={sync.isPending ? 'spin' : ''} />
          {sync.isPending ? 'Syncing…' : 'Sync Prices'}
        </button>
      </div>
    </aside>
  )
}
