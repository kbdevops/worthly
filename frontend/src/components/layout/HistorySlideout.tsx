import { useState } from 'react'
import { X, Plus, Trash2, Pencil, Check } from 'lucide-react'
import type { Snapshot } from '../../types'
import { useAddSnapshot, useDeleteSnapshot } from '../../hooks/useApi'
import { fmtCurrency, fmtDate } from '../../lib/utils'

interface Props {
  type: 'cash' | 'super' | null
  snapshots: Snapshot[]
  onClose: () => void
}

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function HistorySlideout({ type, snapshots, onClose }: Props) {
  const addSnapshot = useAddSnapshot()
  const deleteSnapshot = useDeleteSnapshot()
  const sorted = [...snapshots].sort((a, b) => b.date.localeCompare(a.date))

  const [editingDate, setEditingDate] = useState<string | null>(null)
  const [editCash, setEditCash] = useState('')
  const [editSuper, setEditSuper] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [newDate, setNewDate] = useState(todayStr())
  const [newCash, setNewCash] = useState('')
  const [newSuper, setNewSuper] = useState('')
  const [error, setError] = useState('')

  const startEdit = (s: Snapshot) => {
    setEditingDate(s.date)
    setEditCash(String(s.cash))
    setEditSuper(String(s.super))
    setError('')
  }

  const saveEdit = () => {
    const cash = parseFloat(editCash)
    const superVal = parseFloat(editSuper)
    if (isNaN(cash) || isNaN(superVal) || !editingDate) return
    addSnapshot.mutate({ date: editingDate, cash, super: superVal }, {
      onSuccess: () => setEditingDate(null),
      onError: (e: unknown) => setError((e as { message?: string })?.message || 'Failed to save'),
    })
  }

  const saveNew = () => {
    const cash = parseFloat(newCash)
    const superVal = parseFloat(newSuper)
    if (isNaN(cash) || isNaN(superVal) || !newDate) return
    addSnapshot.mutate({ date: newDate, cash, super: superVal }, {
      onSuccess: () => { setShowAdd(false); setNewCash(''); setNewSuper(''); setNewDate(todayStr()) },
      onError: (e: unknown) => setError((e as { message?: string })?.message || 'Failed to add'),
    })
  }

  return (
    <div
      className="fixed top-0 right-0 h-full w-96 z-40 flex flex-col transition-transform duration-300"
      style={{
        background: '#0d0f1f',
        borderLeft: '1px solid #20264b',
        transform: type ? 'translateX(0)' : 'translateX(100%)',
      }}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#20264b]">
        <h3 className="font-semibold text-white text-sm">Cash &amp; Super History</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
      </div>

      <div className="px-5 py-3 border-b border-[#20264b]">
        <button onClick={() => { setShowAdd(s => !s); setError('') }}
          className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300">
          <Plus size={14} /> Add Entry
        </button>
        {showAdd && (
          <div className="mt-3 space-y-2">
            <input type="date" value={newDate} max={todayStr()} onChange={e => setNewDate(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg text-sm bg-[#151832] border border-[#20264b] text-slate-300 focus:outline-none" />
            <div className="flex gap-2">
              <input type="number" placeholder="Cash" value={newCash} onChange={e => setNewCash(e.target.value)}
                className="w-1/2 px-2.5 py-1.5 rounded-lg text-sm bg-[#151832] border border-[#20264b] text-slate-300 placeholder-slate-600 focus:outline-none" />
              <input type="number" placeholder="Super" value={newSuper} onChange={e => setNewSuper(e.target.value)}
                className="w-1/2 px-2.5 py-1.5 rounded-lg text-sm bg-[#151832] border border-[#20264b] text-slate-300 placeholder-slate-600 focus:outline-none" />
            </div>
            <button onClick={saveNew} disabled={addSnapshot.isPending}
              className="w-full py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
              {addSnapshot.isPending ? 'Saving…' : 'Save Entry'}
            </button>
          </div>
        )}
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead style={{ background: '#060813' }}>
            <tr>
              <th className="px-4 py-2.5 text-left text-xs text-slate-400">Date</th>
              <th className="px-3 py-2.5 text-right text-xs text-slate-400">Cash</th>
              <th className="px-3 py-2.5 text-right text-xs text-slate-400">Super</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => {
              const isEditing = editingDate === s.date
              return (
                <tr key={s.date} className="border-t border-[#20264b] hover:bg-white/5">
                  <td className="px-4 py-2.5 text-xs text-slate-400">{fmtDate(s.date)}</td>
                  {isEditing ? (
                    <>
                      <td className="px-2 py-1.5">
                        <input type="number" value={editCash} onChange={e => setEditCash(e.target.value)}
                          className="w-20 px-1.5 py-1 rounded text-xs text-right bg-[#151832] border border-[#20264b] text-slate-200 focus:outline-none" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" value={editSuper} onChange={e => setEditSuper(e.target.value)}
                          className="w-20 px-1.5 py-1 rounded text-xs text-right bg-[#151832] border border-[#20264b] text-slate-200 focus:outline-none" />
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1.5 justify-end">
                          <button onClick={saveEdit} className="text-emerald-400 hover:text-emerald-300"><Check size={14} /></button>
                          <button onClick={() => setEditingDate(null)} className="text-slate-500 hover:text-slate-300"><X size={14} /></button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2.5 text-sm text-white text-right font-medium">{fmtCurrency(s.cash)}</td>
                      <td className="px-3 py-2.5 text-sm text-white text-right font-medium">{fmtCurrency(s.super)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2 justify-end">
                          <button onClick={() => startEdit(s)} className="text-slate-500 hover:text-white"><Pencil size={13} /></button>
                          <button onClick={() => deleteSnapshot.mutate(s.date)} className="text-slate-500 hover:text-red-400"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-xs text-slate-500">No entries yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="px-5 py-3 border-t border-[#20264b] text-xs text-slate-500">
        Auto-logged on the 1st of each month at 1pm (Melbourne time) using your current Cash total and last known Super figure — edit or add entries here any time in between.
      </div>
    </div>
  )
}