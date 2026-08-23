import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatCurrencyExact, formatDate, formatLabel } from '../lib/format'
import Modal from '../components/Modal'

interface Expense {
  id: string
  category: string | null
  description: string | null
  amount: number
  expense_date: string
}

interface ExpenseFormValues {
  category: string
  description: string
  amount: string
  expense_date: string
}

interface LedgerEntry {
  id: string
  entry_type: 'debit' | 'credit'
  account: string
  amount: number
  description: string | null
  created_at: string
  invoices: { invoice_number: string } | null
}

const categoryOptions = ['rent', 'utilities', 'salaries', 'supplies', 'other']

const emptyForm: ExpenseFormValues = {
  category: 'other',
  description: '',
  amount: '',
  expense_date: new Date().toISOString().slice(0, 10),
}

type Tab = 'expenses' | 'ledger'

export default function Finance() {
  const { membership } = useAuth()
  const isAdmin = membership?.role === 'admin'

  const [tab, setTab] = useState<Tab>('expenses')

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [expensesLoading, setExpensesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(true)

  const [monthlyExpenses, setMonthlyExpenses] = useState(0)
  const [monthlyRevenue, setMonthlyRevenue] = useState(0)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ExpenseFormValues>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function loadExpenses() {
    setExpensesLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('expenses')
      .select('id, category, description, amount, expense_date')
      .order('expense_date', { ascending: false })

    if (error) {
      setError(error.message)
    } else {
      setExpenses(data ?? [])
    }
    setExpensesLoading(false)
  }

  async function loadLedgerEntries() {
    setLedgerLoading(true)
    const { data, error } = await supabase
      .from('ledger_entries')
      .select('id, entry_type, account, amount, description, created_at, invoices(invoice_number)')
      .order('created_at', { ascending: false })

    if (error) setError(error.message)
    setLedgerEntries((data as unknown as LedgerEntry[]) ?? [])
    setLedgerLoading(false)
  }

  async function loadSummary() {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const startOfMonthDate = startOfMonth.toISOString().slice(0, 10)
    const startOfNextMonthDate = startOfNextMonth.toISOString().slice(0, 10)

    const [{ data: expenseRows }, { data: invoiceRows }] = await Promise.all([
      supabase
        .from('expenses')
        .select('amount')
        .gte('expense_date', startOfMonthDate)
        .lt('expense_date', startOfNextMonthDate),
      supabase
        .from('invoices')
        .select('final_price')
        .eq('superseded', false)
        .gte('created_at', startOfMonth.toISOString())
        .lt('created_at', startOfNextMonth.toISOString()),
    ])

    setMonthlyExpenses((expenseRows ?? []).reduce((sum, r) => sum + r.amount, 0))
    setMonthlyRevenue((invoiceRows ?? []).reduce((sum, r) => sum + r.final_price, 0))
  }

  useEffect(() => {
    if (!isAdmin) return
    void loadExpenses()
    void loadLedgerEntries()
    void loadSummary()
  }, [isAdmin])

  const profitEstimate = useMemo(
    () => monthlyRevenue - monthlyExpenses,
    [monthlyRevenue, monthlyExpenses],
  )

  function openAddModal() {
    setEditingId(null)
    setForm(emptyForm)
    setFormError(null)
    setModalOpen(true)
  }

  function openEditModal(expense: Expense) {
    setEditingId(expense.id)
    setForm({
      category: expense.category ?? 'other',
      description: expense.description ?? '',
      amount: expense.amount.toString(),
      expense_date: expense.expense_date,
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!membership) return

    setSaving(true)
    setFormError(null)

    const payload = {
      category: form.category || null,
      description: form.description.trim() || null,
      amount: Number(form.amount) || 0,
      expense_date: form.expense_date,
    }

    const result = editingId
      ? await supabase.from('expenses').update(payload).eq('id', editingId)
      : await supabase.from('expenses').insert({ ...payload, tenant_id: membership.tenantId })

    setSaving(false)

    if (result.error) {
      setFormError(result.error.message)
      return
    }

    setModalOpen(false)
    void loadExpenses()
    void loadSummary()
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this expense? This cannot be undone.')) return
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    setExpenses((prev) => prev.filter((e) => e.id !== id))
    void loadSummary()
  }

  if (!isAdmin) {
    return (
      <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
        Only admins can view finance data.
      </p>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Finance</h1>
        <p className="mt-1 text-sm text-slate-400">Expenses, ledger, and a rough monthly picture.</p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.12)]">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Expenses This Month
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">
            {formatCurrencyExact(monthlyExpenses)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.12)]">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Revenue This Month
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">
            {formatCurrencyExact(monthlyRevenue)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.12)]">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Profit Estimate
          </p>
          <p
            className={`mt-1 text-2xl font-semibold ${
              profitEstimate >= 0 ? 'text-emerald-600' : 'text-red-500'
            }`}
          >
            {formatCurrencyExact(profitEstimate)}
          </p>
        </div>
      </div>

      <div className="mb-4 flex gap-1.5">
        {(['expenses', 'ledger'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-500 hover:text-slate-900'
            }`}
          >
            {t === 'expenses' ? 'Expenses' : 'Ledger'}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}

      {tab === 'expenses' && (
        <div>
          <div className="mb-4 flex justify-end">
            <button
              onClick={openAddModal}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Add Expense
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.12)]">
            {expensesLoading ? (
              <p className="px-6 py-10 text-center text-sm text-slate-400">Loading expenses…</p>
            ) : expenses.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-slate-400">
                No expenses yet. Add your first one.
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                    <th className="px-6 py-3">Category</th>
                    <th className="px-6 py-3">Description</th>
                    <th className="px-6 py-3">Date</th>
                    <th className="px-6 py-3">Amount</th>
                    <th className="px-6 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="px-6 py-3.5">
                        <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                          {formatLabel(expense.category)}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-slate-500">{expense.description ?? '—'}</td>
                      <td className="px-6 py-3.5 text-slate-500">{formatDate(expense.expense_date)}</td>
                      <td className="px-6 py-3.5 font-medium text-slate-700">
                        {formatCurrencyExact(expense.amount)}
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => openEditModal(expense)}
                            className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => void handleDelete(expense.id)}
                            className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'ledger' && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_24px_-16px_rgba(15,23,42,0.12)]">
          {ledgerLoading ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">Loading ledger…</p>
          ) : ledgerEntries.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-400">
              No ledger entries yet. These aren't auto-generated from invoices or expenses yet — that's
              a future refinement.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Account</th>
                  <th className="px-6 py-3">Description</th>
                  <th className="px-6 py-3">Invoice</th>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Amount</th>
                </tr>
              </thead>
              <tbody>
                {ledgerEntries.map((entry) => (
                  <tr key={entry.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-6 py-3.5">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          entry.entry_type === 'credit'
                            ? 'bg-emerald-50 text-emerald-600'
                            : 'bg-red-50 text-red-500'
                        }`}
                      >
                        {formatLabel(entry.entry_type)}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-slate-500">{entry.account}</td>
                    <td className="px-6 py-3.5 text-slate-500">{entry.description ?? '—'}</td>
                    <td className="px-6 py-3.5 text-slate-500">
                      {entry.invoices?.invoice_number ?? '—'}
                    </td>
                    <td className="px-6 py-3.5 text-slate-500">{formatDate(entry.created_at)}</td>
                    <td className="px-6 py-3.5 font-medium text-slate-700">
                      {formatCurrencyExact(entry.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Edit Expense' : 'Add Expense'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              >
                {categoryOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {formatLabel(opt)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Amount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">
              Expense Date
            </label>
            <input
              type="date"
              required
              value={form.expense_date}
              onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">
              Description (optional)
            </label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </div>

          {formError && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Expense'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
