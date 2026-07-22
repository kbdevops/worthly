import { useState, useEffect } from 'react'
import Sidebar from './components/layout/Sidebar'
import Header from './components/layout/Header'
import Dashboard from './components/tabs/Dashboard'
import Holdings from './components/tabs/Holdings'
import Tax from './components/tabs/Tax'
import Milestones from './components/tabs/Milestones'
import Sync from './components/tabs/Sync'
import Dividends from './components/tabs/Dividends'
import AuthScreen from './components/auth/AuthScreen'
import { useAuth, logout } from './lib/auth'

export type TabId = 'dashboard' | 'holdings' | 'tax' | 'milestones' | 'sync' | 'dividends'

const TABS: { id: TabId; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'holdings', label: 'Holdings' },
  { id: 'tax', label: 'Tax' },
  { id: 'dividends', label: 'Dividends' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'sync', label: 'Data Sync' },
]

export default function App() {
  const { isAuthed } = useAuth()
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const saved = localStorage.getItem('activeTab') as TabId
    const valid: TabId[] = ['dashboard', 'holdings', 'tax', 'milestones', 'sync', 'dividends']
    return valid.includes(saved) ? saved : 'dashboard'
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('dash_theme') || 'indigo'
    document.documentElement.setAttribute('data-theme', saved)
  }, [])

  useEffect(() => {
    localStorage.setItem('activeTab', activeTab)
  }, [activeTab])

  const switchTab = (tab: TabId) => {
    setActiveTab(tab)
    setSidebarOpen(false)
  }

  if (!isAuthed) {
    return <AuthScreen onAuthed={() => { /* useAuth() reacts to the auth-change event automatically */ }} />
  }

  return (
    <div className="flex min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={switchTab}
        open={sidebarOpen}
      />

      <div className="flex flex-col flex-1 min-w-0">
        <Header
          activeTab={activeTab}
          tabs={TABS}
          onMenuClick={() => setSidebarOpen(true)}
          onLogout={logout}
        />

        <main className="flex-1 p-4 md:p-6 overflow-auto">
          {activeTab === 'dashboard' && <Dashboard />}
          {activeTab === 'holdings' && <Holdings />}
          {activeTab === 'tax' && <Tax />}
          {activeTab === 'milestones' && <Milestones />}
          {activeTab === 'sync' && <Sync />}
          {activeTab === 'dividends' && <Dividends />}
        </main>
      </div>
    </div>
  )
}