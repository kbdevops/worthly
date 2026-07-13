import { X } from 'lucide-react'
import type { Snapshot } from '../../types'
import { fmtCurrency, fmtDate } from '../../lib/utils'

interface Props {
  type: 'cash' | 'super' | null
  snapshots: Snapshot[]
  onClose: () => void
}

export default function HistorySlideout({ type, snapshots, onClose }: Props) {
  const sorted = [...snapshots].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div
      className="fixed top-0 right-0 h-full w-80 z-40 flex flex-col transition-transform duration-300"
      style={{
        background: '#0d0f1f',
        borderLeft: '1px solid #20264b',
        transform: type ? 'translateX(0)' : 'translateX(100%)',
      }}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#20264b]">
        <h3 className="font-semibold text-white text-sm">
          {type === 'cash' ? 'Cash' : 'Super'} History
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full">
          <thead style={{ background: '#060813' }}>
            <tr>
              <th className="px-5 py-3 text-left text-xs text-slate-400">Date</th>
              <th className="px-5 py-3 text-right text-xs text-slate-400">Balance</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => (
              <tr key={s.date} className="border-t border-[#20264b]">
                <td className="px-5 py-3 text-sm text-slate-300">{fmtDate(s.date)}</td>
                <td className="px-5 py-3 text-sm text-white text-right font-medium">
                  {fmtCurrency(type === 'cash' ? s.cash : s.super)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
