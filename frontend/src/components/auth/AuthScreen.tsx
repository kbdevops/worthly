import { useState } from 'react'
import { login, register } from '../../lib/auth'

export default function AuthScreen({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        await login(email, password, remember)
      } else {
        await register(email, password, remember)
      }
      onAuthed()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-base)' }}>
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] p-6" style={{ background: 'var(--bg-card)' }}>
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>W</div>
          <span className="text-lg font-semibold text-white">Worthly</span>
        </div>

        <div className="flex rounded-lg overflow-hidden border border-[var(--border)] mb-5">
          {(['login', 'register'] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setError('') }}
              className="flex-1 py-2 text-sm font-medium transition-all"
              style={mode === m ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--bg-elevated)', color: '#94a3b8' }}>
              {m === 'login' ? 'Log In' : 'Register'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Username</label>
            <input type="text" required value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="username"
              className="w-full px-3 py-2 rounded-lg text-sm text-slate-200 focus:outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Password</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className="w-full px-3 py-2 rounded-lg text-sm text-slate-200 focus:outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}
              className="accent-[var(--accent)]" />
            <span className="text-sm text-slate-400">Keep me signed in</span>
          </label>

          <button type="submit" disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60 mt-2"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Log In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}