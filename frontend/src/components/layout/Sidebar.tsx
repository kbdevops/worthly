import { LayoutDashboard, Briefcase, Calculator, Award, RefreshCw } from 'lucide-react'
import type { TabId } from '../../App'
import { useSync } from '../../hooks/useApi'
import { cn } from '../../lib/utils'

const ICONS: Record<TabId, React.ReactNode> = {
  dashboard: <LayoutDashboard size={18} />,
  holdings: <Briefcase size={18} />,
  tax: <Calculator size={18} />,
  milestones: <Award size={18} />,
  sync: <RefreshCw size={18} />,
}

interface Props {
  tabs: { id: TabId; label: string }[]
  activeTab: TabId
  onTabChange: (tab: TabId) => void
  open: boolean
}

export default function Sidebar({ tabs, activeTab, onTabChange, open }: Props) {
  const sync = useSync()

  return (
    <aside
      className={cn(
        'fixed top-0 left-0 z-30 h-full w-64 flex flex-col transition-transform duration-300',
        'lg:relative lg:translate-x-0 lg:flex',
        open ? 'translate-x-0' : '-translate-x-full'
      )}
      style={{ background: 'var(--bg-elevated)', borderRight: '1px solid var(--border)' }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2 px-5 py-5 border-b border-[var(--border)]">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
          <span className="text-white text-xs font-bold">W</span>
        </div>
        <span className="font-semibold text-white text-sm">Worthly</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
              activeTab === tab.id
                ? 'text-white'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            )}
            style={activeTab === tab.id ? {
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 20%, transparent), color-mix(in srgb, var(--accent-2) 20%, transparent))',
              color: 'var(--accent)',
              borderLeft: '2px solid var(--accent)',
            } : {}}
          >
            {ICONS[tab.id]}
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Sync panel */}
      <div className="px-4 py-4 border-t border-[var(--border)]">
        <button
          onClick={() => sync.mutate(false)}
          disabled={sync.isPending}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
        >
          <RefreshCw size={14} className={sync.isPending ? 'spin' : ''} />
          {sync.isPending ? 'Syncing…' : 'Sync Prices'}
        </button>
      </div>
    </aside>
  )
}
