import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import { ALL_PERMISSIONS, PERMISSION_DESCRIPTIONS, PERMISSION_LABELS } from '../lib/permissions'
import type { PermissionKey } from '../lib/permissions'

type Role = 'admin' | 'staff'

interface TeamMember {
  id: string
  user_id: string
  name: string | null
  email: string
  role: Role
  permissions: string[]
}

interface AddFormValues {
  name: string
  email: string
  password: string
  role: Role
  permissions: PermissionKey[]
}

interface EditFormValues {
  name: string
  role: Role
  permissions: PermissionKey[]
}

const emptyAddForm: AddFormValues = {
  name: '',
  email: '',
  password: '',
  role: 'staff',
  permissions: [],
}

async function extractFunctionError(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      if (body?.error) return body.error as string
    } catch {
      // fall through to the generic message below
    }
  }
  return error instanceof Error ? error.message : fallback
}

function togglePermission(list: PermissionKey[], key: PermissionKey): PermissionKey[] {
  return list.includes(key) ? list.filter((p) => p !== key) : [...list, key]
}

export default function Team() {
  const { membership } = useAuth()

  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState<AddFormValues>(emptyAddForm)
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)
  const [editForm, setEditForm] = useState<EditFormValues>({ name: '', role: 'staff', permissions: [] })
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [removingId, setRemovingId] = useState<string | null>(null)

  const adminCount = members.filter((m) => m.role === 'admin').length

  async function loadMembers() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase
      .from('tenant_members')
      .select('id, user_id, name, email, role, permissions')
      .order('created_at', { ascending: true })

    if (error) {
      setError(error.message)
    } else {
      setMembers((data as unknown as TeamMember[]) ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadMembers()
  }, [])

  function openAddModal() {
    setAddForm(emptyAddForm)
    setAddError(null)
    setAddOpen(true)
  }

  async function handleAddSubmit(e: FormEvent) {
    e.preventDefault()
    setAddSaving(true)
    setAddError(null)

    const { error } = await supabase.functions.invoke('team-create-member', {
      body: {
        email: addForm.email.trim(),
        password: addForm.password,
        name: addForm.name.trim(),
        role: addForm.role,
        permissions: addForm.role === 'staff' ? addForm.permissions : [],
      },
    })

    setAddSaving(false)

    if (error) {
      setAddError(await extractFunctionError(error, 'Failed to create member.'))
      return
    }

    setAddOpen(false)
    void loadMembers()
  }

  function openEditModal(member: TeamMember) {
    setEditingMember(member)
    setEditForm({
      name: member.name ?? '',
      role: member.role,
      permissions: member.permissions as PermissionKey[],
    })
    setEditError(null)
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault()
    if (!editingMember) return

    setEditSaving(true)
    setEditError(null)

    const { error } = await supabase
      .from('tenant_members')
      .update({
        name: editForm.name.trim() || null,
        role: editForm.role,
        permissions: editForm.role === 'staff' ? editForm.permissions : [],
      })
      .eq('id', editingMember.id)

    setEditSaving(false)

    if (error) {
      setEditError(error.message)
      return
    }

    setEditingMember(null)
    void loadMembers()
  }

  async function handleRemove(member: TeamMember) {
    if (!window.confirm(`Remove ${member.name || member.email}? This deletes their login too.`)) return

    setRemovingId(member.id)
    setError(null)

    const { error } = await supabase.functions.invoke('team-remove-member', {
      body: { member_id: member.id },
    })

    setRemovingId(null)

    if (error) {
      setError(await extractFunctionError(error, 'Failed to remove member.'))
      return
    }

    setMembers((prev) => prev.filter((m) => m.id !== member.id))
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Team</h1>
          <p className="mt-1 text-sm text-slate-400">Manage who has access and what they can do.</p>
        </div>
        <button
          onClick={openAddModal}
          className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2 text-sm font-medium transition-opacity"
        >
          Add Member
        </button>
      </div>

      {error && (
        <p className="mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
      )}

      <div className="overflow-hidden rounded-2xl bg-white card-shadow">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">Loading team…</p>
        ) : members.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No members yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-medium uppercase tracking-wide text-slate-400">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3">Role</th>
                <th className="px-6 py-3">Permissions</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const isSelf = member.id === membership?.id
                const isLastAdmin = member.role === 'admin' && adminCount <= 1
                return (
                  <tr key={member.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-6 py-3.5 font-medium text-slate-900">
                      {member.name || '—'}
                      {isSelf && <span className="ml-2 text-xs font-normal text-slate-400">(you)</span>}
                    </td>
                    <td className="px-6 py-3.5 text-slate-500">{member.email}</td>
                    <td className="px-6 py-3.5">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          member.role === 'admin' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {member.role === 'admin' ? 'Admin' : 'Staff'}
                      </span>
                    </td>
                    <td className="px-6 py-3.5">
                      {member.role === 'admin' ? (
                        <span className="text-xs text-slate-400">Full access</span>
                      ) : member.permissions.length === 0 ? (
                        <span className="text-xs text-slate-400">No access</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {member.permissions.map((p) => (
                            <span
                              key={p}
                              className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
                            >
                              {PERMISSION_LABELS[p as PermissionKey] ?? p}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openEditModal(member)}
                          className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void handleRemove(member)}
                          disabled={isSelf || isLastAdmin || removingId === member.id}
                          title={
                            isSelf
                              ? "You can't remove yourself"
                              : isLastAdmin
                                ? 'A tenant needs at least one admin'
                                : undefined
                          }
                          className="rounded-lg px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          {removingId === member.id ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Member">
        <form onSubmit={handleAddSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Name</label>
            <input
              type="text"
              required
              value={addForm.name}
              onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Email</label>
            <input
              type="email"
              required
              autoComplete="off"
              value={addForm.email}
              onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Password</label>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={addForm.password}
              onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Role</label>
            <div className="flex gap-2">
              {(['staff', 'admin'] as Role[]).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setAddForm({ ...addForm, role })}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    addForm.role === role
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {role === 'admin' ? 'Admin' : 'Staff'}
                </button>
              ))}
            </div>
          </div>

          {addForm.role === 'staff' && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Permissions</label>
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                {ALL_PERMISSIONS.map((key) => (
                  <label key={key} className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={addForm.permissions.includes(key)}
                      onChange={() =>
                        setAddForm({ ...addForm, permissions: togglePermission(addForm.permissions, key) })
                      }
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                    />
                    <span className="text-sm text-slate-700">
                      {PERMISSION_LABELS[key]}
                      <span className="ml-1.5 text-xs text-slate-400">{PERMISSION_DESCRIPTIONS[key]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {addError && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{addError}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addSaving}
              className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
            >
              {addSaving ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={editingMember !== null}
        onClose={() => setEditingMember(null)}
        title={`Edit ${editingMember?.name || editingMember?.email || 'Member'}`}
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Name</label>
            <input
              type="text"
              required
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-600">Role</label>
            <div className="flex gap-2">
              {(['staff', 'admin'] as Role[]).map((role) => (
                <button
                  key={role}
                  type="button"
                  disabled={editingMember?.role === 'admin' && adminCount <= 1 && role !== 'admin'}
                  onClick={() => setEditForm({ ...editForm, role })}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
                    editForm.role === role
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {role === 'admin' ? 'Admin' : 'Staff'}
                </button>
              ))}
            </div>
            {editingMember?.role === 'admin' && adminCount <= 1 && (
              <p className="mt-1.5 text-xs text-slate-400">
                This is the only admin, so their role can't be downgraded here.
              </p>
            )}
          </div>

          {editForm.role === 'staff' && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Permissions</label>
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                {ALL_PERMISSIONS.map((key) => (
                  <label key={key} className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={editForm.permissions.includes(key)}
                      onChange={() =>
                        setEditForm({ ...editForm, permissions: togglePermission(editForm.permissions, key) })
                      }
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                    />
                    <span className="text-sm text-slate-700">
                      {PERMISSION_LABELS[key]}
                      <span className="ml-1.5 text-xs text-slate-400">{PERMISSION_DESCRIPTIONS[key]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {editError && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{editError}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setEditingMember(null)}
              className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={editSaving}
              className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
            >
              {editSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
