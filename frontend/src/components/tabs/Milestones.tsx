import { useState } from 'react'
import { Plus, Trash2, X, Edit2, TrendingUp, Award, Star, Trophy, Zap, Flame } from 'lucide-react'
import { useMilestones, useAddMilestone, useUpdateMilestone, useDeleteMilestone } from '../../hooks/useApi'
import { fmtCurrency, fmtPct } from '../../lib/utils'
import type { Milestone } from '../../types'

const CATEGORIES = [
  { id: 'financial', label: 'Financial', icon: TrendingUp, color: '#6366f1' },
  { id: 'personal',  label: 'Personal',  icon: Award,      color: '#f59e0b' },
  { id: 'other',     label: 'Other',     icon: Star,       color: '#a855f7' },
]

const METRICS = [
  { id: 'portfolio',  label: 'Portfolio Value',  fmt: (v: number) => fmtCurrency(v) },
  { id: 'networth',   label: 'Net Worth',         fmt: (v: number) => fmtCurrency(v) },
  { id: 'cash',       label: 'Cash',              fmt: (v: number) => fmtCurrency(v) },
  { id: 'super',      label: 'Super',             fmt: (v: number) => fmtCurrency(v) },
  { id: 'return_aud', label: 'Total Return ($)',  fmt: (v: number) => fmtCurrency(v) },
  { id: 'return_pct', label: 'Total Return (%)',  fmt: (v: number) => fmtPct(v) },
]

type Filter = 'all' | 'goals' | 'achievements'

// Circular SVG progress ring
function ProgressRing({ pct, color, size = 96 }: { pct: number; color: string; size?: number }) {
  const r = (size - 12) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (Math.min(pct, 100) / 100) * circ
  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={6} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={pct >= 100 ? '#10b981' : color}
        strokeWidth={6} strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
    </svg>
  )
}

function MilestoneCard({ m, onEdit, onDelete }: { m: Milestone; onEdit: () => void; onDelete: () => void }) {
  const cat = CATEGORIES.find(c => c.id === m.category) || CATEGORIES[2]
  const Icon = cat.icon
  const isGoal = m.type === 'goal'
  const achieved = m.is_achieved || !isGoal
  const pct = isGoal && m.target_value && m.current_value != null
    ? Math.min(100, (m.current_value / m.target_value) * 100)
    : 100
  const remaining = isGoal && m.target_value && m.current_value != null
    ? Math.max(0, m.target_value - m.current_value)
    : null
  const metricFmt = METRICS.find(x => x.id === m.linked_metric)?.fmt || fmtCurrency

  return (
    <div
      className="rounded-2xl p-5 border transition-all group relative overflow-hidden"
      style={{
        background: achieved ? 'linear-gradient(135deg, rgba(16,185,129,0.07), var(--bg-card))' : 'var(--bg-card)',
        borderColor: achieved ? 'rgba(16,185,129,0.35)' : 'var(--border)',
      }}
    >
      {achieved && <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at top right, rgba(16,185,129,0.07), transparent 70%)' }} />}

      <div className="flex items-start gap-4">
        {/* Ring */}
        <div className="relative flex-shrink-0 flex items-center justify-center" style={{ width: 88, height: 88 }}>
          <ProgressRing pct={pct} color={cat.color} size={88} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {achieved
              ? <Trophy size={20} className="text-green-400" />
              : <span className="text-base font-bold text-white">{pct.toFixed(0)}%</span>
            }
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h3 className="text-base font-semibold text-white">{m.title}</h3>
                {achieved && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-semibold">🏆 {isGoal ? 'Achieved' : 'Done'}</span>}
              </div>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: `${cat.color}22`, color: cat.color }}>
                  <Icon size={10} className="inline mr-1" />{cat.label}
                </span>
                <span className="text-xs text-slate-500">
                  {new Date(m.date).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
                {isGoal && m.linked_metric && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-500">
                    {METRICS.find(x => x.id === m.linked_metric)?.label}
                  </span>
                )}
              </div>
              {m.description && <p className="text-xs text-slate-400 mb-2">{m.description}</p>}

              {isGoal && m.target_value != null && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400">{m.current_value != null ? metricFmt(m.current_value) : '—'}</span>
                    <span className="text-slate-600">of</span>
                    <span className="text-slate-300 font-medium">{metricFmt(m.target_value)}</span>
                  </div>
                  {!achieved && remaining != null && (
                    <div className="flex items-center gap-1.5">
                      <Zap size={10} className="text-amber-400" />
                      <span className="text-xs text-amber-300 font-medium">{metricFmt(remaining)} remaining</span>
                    </div>
                  )}
                  {achieved && m.achieved_date && (
                    <div className="flex items-center gap-1.5">
                      <Flame size={10} className="text-green-400" />
                      <span className="text-xs text-green-400">Completed {new Date(m.achieved_date).toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                    </div>
                  )}
                  <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${pct}%`, background: pct >= 100 ? '#10b981' : `linear-gradient(90deg, ${cat.color}, ${cat.color}aa)` }} />
                  </div>
                </div>
              )}

              {!isGoal && m.value != null && (
                <span className="text-sm font-semibold text-slate-300">{fmtCurrency(m.value)}</span>
              )}
            </div>

            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <button onClick={onEdit} className="p-1.5 rounded-md text-slate-500 hover:text-blue-400 hover:bg-blue-400/10 transition-all"><Edit2 size={13} /></button>
              <button onClick={onDelete} className="p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-all"><Trash2 size={13} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Milestones() {
  const { data: milestones } = useMilestones()
  const addMilestone = useAddMilestone()
  const updateMilestone = useUpdateMilestone()
  const deleteMilestone = useDeleteMilestone()

  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const blank = {
    date: new Date().toISOString().slice(0, 10),
    title: '', description: '', category: 'financial',
    value: '', type: 'achievement' as 'achievement' | 'goal',
    target_value: '', linked_metric: '' as string,
    is_achieved: false, achieved_date: null as string | null,
  }
  const [form, setForm] = useState(blank)

  function openAdd() { setEditingId(null); setForm(blank); setShowModal(true) }
  function openEdit(m: Milestone) {
    setEditingId(m.id)
    setForm({
      date: m.date, title: m.title, description: m.description || '',
      category: m.category, value: m.value != null ? String(m.value) : '',
      type: m.type, target_value: m.target_value != null ? String(m.target_value) : '',
      linked_metric: m.linked_metric || '', is_achieved: m.is_achieved,
      achieved_date: m.achieved_date,
    })
    setShowModal(true)
  }

  function handleSubmit() {
    if (!form.title.trim()) return
    const payload = {
      date: form.date, title: form.title.trim(), description: form.description.trim(),
      category: form.category, value: form.value ? parseFloat(form.value) : null,
      type: form.type, linked_metric: form.linked_metric || null,
      target_value: form.target_value ? parseFloat(form.target_value) : null,
      current_value: null, is_achieved: false, achieved_date: null,
    }
    if (editingId) {
      updateMilestone.mutate({ ...payload, id: editingId, is_achieved: form.is_achieved, achieved_date: form.achieved_date })
    } else {
      addMilestone.mutate(payload)
    }
    setShowModal(false)
  }

  const filtered = (milestones || []).filter(m =>
    filter === 'all' ? true : filter === 'goals' ? m.type === 'goal' : m.type === 'achievement'
  )
  const goals = filtered.filter(m => m.type === 'goal')
  const achievements = filtered.filter(m => m.type === 'achievement')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex gap-1">
          {(['all', 'goals', 'achievements'] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-3 py-1.5 text-xs rounded-lg font-medium transition-all capitalize"
              style={filter === f ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--bg-elevated)', color: '#94a3b8' }}
            >{f}</button>
          ))}
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}
        ><Plus size={14} /> Add</button>
      </div>

      {/* Goals section */}
      {goals.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Goals</p>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {goals.map(m => <MilestoneCard key={m.id} m={m} onEdit={() => openEdit(m)} onDelete={() => deleteMilestone.mutate(m.id)} />)}
          </div>
        </div>
      )}

      {/* Achievements section */}
      {achievements.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Achievements</p>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {achievements.map(m => <MilestoneCard key={m.id} m={m} onEdit={() => openEdit(m)} onDelete={() => deleteMilestone.mutate(m.id)} />)}
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-16 text-slate-500">
          <Trophy size={48} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">No {filter === 'all' ? 'milestones' : filter} yet.</p>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setShowModal(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] p-6 max-h-[90vh] overflow-y-auto"
            style={{ background: 'var(--bg-card)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-white">{editingId ? 'Edit' : 'Add'} Milestone</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-white"><X size={18} /></button>
            </div>

            <div className="space-y-4">
              {/* Type */}
              <div className="flex gap-2">
                {(['achievement', 'goal'] as const).map(t => (
                  <button key={t} onClick={() => setForm({ ...form, type: t })}
                    className="flex-1 px-3 py-2.5 rounded-lg text-sm font-medium capitalize transition-all"
                    style={form.type === t ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: '#94a3b8' }}
                  >{t === 'goal' ? '🎯 Goal' : '🏆 Achievement'}</button>
                ))}
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Category</label>
                <div className="flex gap-2 flex-wrap">
                  {CATEGORIES.map(c => {
                    const Icon = c.icon
                    const on = form.category === c.id
                    return (
                      <button key={c.id} onClick={() => setForm({ ...form, category: c.id })}
                        className="flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-all"
                        style={on ? { background: `${c.color}22`, color: c.color, border: `1px solid ${c.color}` } : { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: '#94a3b8' }}
                      ><Icon size={15} />{c.label}</button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Date</label>
                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 focus:outline-none"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Title *</label>
                <input type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Reach $100k portfolio"
                  className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5">Description (optional)</label>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                  rows={2} placeholder="Notes..."
                  className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none resize-none"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
              </div>

              {form.type === 'goal' && (
                <>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Track Metric</label>
                    <p className="text-xs text-slate-500 mb-2">Auto-updates progress from live app data — no manual entry needed.</p>
                    <select value={form.linked_metric} onChange={e => setForm({ ...form, linked_metric: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 focus:outline-none"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                      <option value="">— pick a metric —</option>
                      {METRICS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1.5">Target Value</label>
                    <input type="number" value={form.target_value} onChange={e => setForm({ ...form, target_value: e.target.value })}
                      placeholder="e.g. 100000"
                      className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
                  </div>
                </>
              )}

              {form.type === 'achievement' && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5">Value (optional)</label>
                  <input type="number" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })}
                    placeholder="e.g. 100000"
                    className="w-full px-3 py-2 rounded-lg text-sm text-slate-300 placeholder-slate-600 focus:outline-none"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 rounded-lg text-sm text-slate-400 border border-[var(--border)] hover:border-[var(--border-hover)]">Cancel</button>
                <button onClick={handleSubmit} disabled={!form.title.trim() || addMilestone.isPending || updateMilestone.isPending}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
                  {addMilestone.isPending || updateMilestone.isPending ? 'Saving...' : editingId ? 'Update' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
