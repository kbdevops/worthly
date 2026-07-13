import { Menu } from 'lucide-react'
import type { TabId } from '../../App'

interface Props {
  activeTab: TabId
  tabs: { id: TabId; label: string }[]
  onMenuClick: () => void
}

export default function Header({ activeTab, tabs, onMenuClick }: Props) {
  const label = tabs.find(t => t.id === activeTab)?.label ?? ''
  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <header
      className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-[var(--border)] sticky top-0 z-10"
      style={{ background: 'var(--bg-base)' }}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-lg font-semibold text-white">{label}</h1>
      </div>
      <span className="text-sm text-slate-400 hidden sm:block">{today}</span>
    </header>
  )
}
