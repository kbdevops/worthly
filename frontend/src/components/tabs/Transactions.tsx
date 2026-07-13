import { useState, useMemo } from 'react'
import { Plus, Trash2, Search } from 'lucide-react'
import { useTransactions, useAddTransaction, useDeleteTransaction } from '../../hooks/useApi'
import { fmtCurrency, fmtDate } from '../../lib/utils'

const EXCHANGES = ['All', 'ASX', 'NASDAQ', 'NYSE', 'US']
const ACTIONS = ['All', 'buy', 'sell', 'split']

const TH = 'px-3 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap'
const TD = 'px-3 py-3 text-sm whitespace-nowrap'

export default function Transactions() {
  const { data: txns = [] } = useTransactions()
  const addTxn = useAddTransaction()
  const deleteTxn = useDeleteTransaction()

  const [search, setSearch] = useState('')
  const [filterAction, setFilterAction] = useState('All')
  const [filterMarket, setFilterMarket] = useState('All')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    exchange: 'ASX', ticker: '', name: '', action: 'buy',
    units: '', price: '', brokerage: '',
  })

  const filtered = useMemo(() => {
    return txns.filter(t => {
      const matchSearch = !search || t.ticker.toLowerCase().includes(search.toLowerCase())
      const matchAction = filterAction === 'All' || t.action === filterAction
      const matchMarket = filterMarket === 'All' || t.exchange === filterMarket
      return matchSearch && matchAction && matchMarket
    })
  }, [txns, search, filterAction, filterMarket])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    addTxn.mutate({
      ...form,
      units: parseFloat(form.units),
      price: parseFloat(form.price) || 0,
      brokerage: parseFloat(form.brokerage) || 0,
    }, {
      onSuccess: () => setShowModal(false),
    })
  }

  const handleDelete = (idx: number) => {
    if (!confirm('Delete this transaction?')) return
    deleteTxn.mutate(idx)
  }

  const currency = ['NASDAQ', 'NYSE', 'US'].includes(form.exchange) ? 'USD' : 'AUD'

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ticker…"
            className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-[var(--bg-card)] border border-[var(--border)] text-slate-300 placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
        </div>
        <select value={filterAction} onChange={e => setFilterAction(e.target.value)}
          className="py-2 px-3 rounded-lg text-sm bg-[var(--bg-card)] border border-[var(--border)] text-slate-300 focus:outline-none focus:border-indigo-500">
          {ACTIONS.map(a => <option key={a}>{a}</option>)}
        </select>
        <select value={filterMarket} onChange={e => setFilterMarket(e.target.value)}
          className="py-2 px-3 rounded-lg text-sm bg-[var(--bg-card)] border border-[var(--border)] text-slate-300 focus:outline-none focus:border-indigo-500">
          {EXCHANGES.map(e => <option key={e}>{e}</option>)}
        </select>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
          <Plus size={14} /> Add Transaction
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-[var(--border)] overflow-hidden" style={{ background: 'var(--bg-card)' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead style={{ background: 'var(--bg-elevated)' }}>
              <tr>
                <th className={TH}>Date</th><th className={TH}>Ticker</th><th className={TH}>Exchange</th>
                <th className={TH}>Action</th><th className={TH}>Units</th><th className={TH}>Price</th>
                <th className={TH}>Currency</th><th className={TH}>Brokerage</th><th className={TH}>FX Rate</th>
                <th className={TH}>AUD Value</th><th className={TH}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => (
                <tr key={i} className="border-t border-[var(--border)] hover:bg-white/5">
                  <td className={TD + ' text-slate-400'}>{fmtDate(t.date)}</td>
                  <td className={TD + ' font-medium text-white'}>{t.ticker}</td>
                  <td className={TD + ' text-slate-400'}>{t.exchange}</td>
                  <td className={TD}>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.action === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : t.action === 'sell' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                      {t.action}
                    </span>
                  </td>
                  <td className={TD + ' text-slate-300'}>{t.units}</td>
                  <td className={TD + ' text-slate-300'}>{t.price}</td>
                  <td className={TD + ' text-slate-400'}>{t.currency}</td>
                  <td className={TD + ' text-slate-400'}>{t.brokerage}</td>
                  <td className={TD + ' text-slate-400'}>{t.exch_rate}</td>
                  <td className={TD + ' text-white font-medium'}>{fmtCurrency(Math.abs(t.value))}</td>
                  <td className={TD}>
                    <button onClick={() => handleDelete(i)} className="text-slate-500 hover:text-red-400"><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-12 text-slate-500 text-sm">No transactions found</div>
          )}
        </div>
      </div>

      {/* Add Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] p-6" style={{ background: 'var(--bg-card)' }}>
            <h2 className="text-lg font-semibold text-white mb-5">Add Transaction</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Date', key: 'date', type: 'date' },
                  { label: 'Exchange', key: 'exchange', type: 'select', options: ['ASX','NASDAQ','NYSE','US'] },
                  { label: 'Ticker', key: 'ticker', type: 'text', placeholder: 'e.g. VAS' },
                  { label: 'Name', key: 'name', type: 'text', placeholder: 'Company name' },
                  { label: 'Action', key: 'action', type: 'select', options: ['buy','sell','split'] },
                  { label: 'Units', key: 'units', type: 'number', placeholder: '0' },
                  { label: `Price (${currency})`, key: 'price', type: 'number', placeholder: '0.00' },
                  { label: `Brokerage (${currency})`, key: 'brokerage', type: 'number', placeholder: '0.00' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs text-slate-400 mb-1">{f.label}</label>
                    {f.type === 'select' ? (
                      <select value={form[f.key as keyof typeof form]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--bg-elevated)] border border-[var(--border)] text-slate-300 focus:outline-none focus:border-indigo-500">
                        {f.options!.map(o => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input type={f.type} value={form[f.key as keyof typeof form]} placeholder={f.placeholder}
                        onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--bg-elevated)] border border-[var(--border)] text-slate-300 focus:outline-none focus:border-indigo-500"
                        disabled={form.action === 'split' && (f.key === 'price' || f.key === 'brokerage')}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 rounded-lg text-sm text-slate-400 border border-[var(--border)] hover:border-[var(--border-hover)]">
                  Cancel
                </button>
                <button type="submit" disabled={addTxn.isPending}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium text-white disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-2))' }}>
                  {addTxn.isPending ? 'Adding…' : 'Add Transaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
