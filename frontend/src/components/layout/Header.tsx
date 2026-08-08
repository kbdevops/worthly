import { useState, useEffect } from 'react'
import { Menu, LogOut, KeyRound, RefreshCw, Check } from 'lucide-react'
import type { TabId } from '../../App'
import { getStoredUser } from '../../lib/auth'
import { usePortfolio, useRefreshPrices } from '../../hooks/useApi'
import { refreshMessage, relativeAge } from '../../lib/refreshMessage'
import ChangePasswordModal from '../auth/ChangePasswordModal'

interface Props {
  activeTab: TabId
  tabs: { id: TabId; label: string }[]
  onMenuClick: () => void
  onLogout: () => void
}

export default function Header({ activeTab, tabs, onMenuClick, onLogout }: Props) {
  const label = tabs.find(t => t.id === activeTab)?.label ?? ''
  const user = getStoredUser()
  const [showChangePw, setShowChangePw] = useState(false)
  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  // The pull gesture is touch-only, so on a desktop there was no way to force a refresh
  // and no hint that prices are ever anything but current. This button is the discoverable
  // version of the same action, and the age label is what tells you whether you need it.
  const { data: holdings } = usePortfolio()
  const refresh = useRefreshPrices()
  const [done, setDone] = useState<string | null>(null)

  const newest = (holdings ?? [])
    .map(h => h.last_synced)
    .filter((d): d is string => !!d)
    .sort()
    .pop()
  const age = relativeAge(newest)

  useEffect(() => {
    if (!done) return
    const t = window.setTimeout(() => setDone(null), 4000)
    return () => window.clearTimeout(t)
  }, [done])

  const syncNow = async () => {
    if (refresh.isPending) return
    try {
      setDone(refreshMessage(await refresh.mutateAsync()))
    } catch {
      setDone("Couldn't reach the price feed")
    }
  }

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
      <div className="flex items-center gap-4">
        {done && (
          <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--accent)' }}>
            <Check size={13} />
            <span className="hidden sm:inline">{done}</span>
          </span>
        )}
        <button
          onClick={syncNow}
          disabled={refresh.isPending}
          title={age ? `Prices updated ${age} — click to sync now` : 'Sync prices now'}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-60"
        >
          <RefreshCw size={15} className={refresh.isPending ? 'animate-spin' : ''} />
          <span className="text-xs hidden md:inline">{refresh.isPending ? 'Syncing…' : 'Sync'}</span>
        </button>
        <span className="text-sm text-slate-400 hidden sm:block">{today}</span>
        {user && (
          <div className="flex items-center gap-2.5">
            <span className="text-xs text-slate-500 hidden md:block">{user.email}</span>
            <button onClick={() => setShowChangePw(true)} title="Change password"
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10">
              <KeyRound size={16} />
            </button>
            <button onClick={onLogout} title="Log out"
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10">
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>

      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
    </header>
  )
}