import { useState } from 'react'
import { X, Check } from 'lucide-react'
import { getToken } from '../../lib/auth'

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (next !== confirm) {
      setError("New passwords don't match")
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ current_password: current, new_password: next }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Something went wrong')
      setDone(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] p-5" style={{ background: 'var(--bg-card)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white">Change Password</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={16} /></button>
        </div>

        {done ? (
          <div className="text-center py-4">
            <Check size={28} className="text-emerald-400 mx-auto mb-3" />
            <p className="text-sm text-slate-200 mb-4">Password updated.</p>
            <button onClick={onClose} className="w-full py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>Done</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Current Password</label>
              <input type="password" required autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-slate-200 focus:outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">New Password</label>
              <input type="password" required autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-slate-200 focus:outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Confirm New Password</label>
              <input type="password" required autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm text-slate-200 focus:outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60 mt-1"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
              {loading ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}