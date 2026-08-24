import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Account() {
  const { user, membership, refreshMembership } = useAuth()

  const [name, setName] = useState(membership?.name ?? '')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameSaved, setNameSaved] = useState(false)

  const [newPassword, setNewPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSaved, setPasswordSaved] = useState(false)

  async function handleNameSubmit(e: FormEvent) {
    e.preventDefault()
    setNameSaving(true)
    setNameError(null)
    setNameSaved(false)

    const { error } = await supabase.rpc('update_own_name', { p_name: name.trim() })

    setNameSaving(false)

    if (error) {
      setNameError(error.message)
      return
    }

    setNameSaved(true)
    void refreshMembership()
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault()
    setPasswordSaving(true)
    setPasswordError(null)
    setPasswordSaved(false)

    const { error } = await supabase.auth.updateUser({ password: newPassword })

    setPasswordSaving(false)

    if (error) {
      setPasswordError(error.message)
      return
    }

    setNewPassword('')
    setPasswordSaved(true)
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-slate-900">Account</h1>
        <p className="mt-1 text-sm text-slate-400">Your name, login email, and password.</p>
      </div>

      <div className="max-w-lg space-y-6">
        <section className="rounded-2xl bg-white p-5 card-shadow">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Profile</h2>
          <form onSubmit={handleNameSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Email</label>
              <input
                type="email"
                disabled
                value={user?.email ?? ''}
                className="w-full rounded-xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm text-slate-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameSaved(false)
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              />
            </div>

            {nameError && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{nameError}</p>
            )}
            {nameSaved && !nameError && (
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-600">Saved.</p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={nameSaving}
                className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
              >
                {nameSaving ? 'Saving…' : 'Save Name'}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-2xl bg-white p-5 card-shadow">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Change Password</h2>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-600">New Password</label>
              <input
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value)
                  setPasswordSaved(false)
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-slate-400 focus:bg-white"
              />
            </div>

            {passwordError && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{passwordError}</p>
            )}
            {passwordSaved && !passwordError && (
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-600">
                Password updated.
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={passwordSaving}
                className="rounded-xl bg-slate-900 text-white hover:opacity-90 active:opacity-100 px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-50"
              >
                {passwordSaving ? 'Updating…' : 'Update Password'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
