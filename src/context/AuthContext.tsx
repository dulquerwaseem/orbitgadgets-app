import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type TenantRole = 'admin' | 'staff'

export interface TenantMembership {
  id: string
  tenantId: string
  role: TenantRole
  name: string | null
  permissions: string[]
}

interface AuthState {
  session: Session | null
  user: User | null
  membership: TenantMembership | null
  loading: boolean
  signOut: () => Promise<void>
  refreshMembership: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [membership, setMembership] = useState<TenantMembership | null>(null)
  const [loading, setLoading] = useState(true)

  async function loadMembership(userId: string) {
    const { data, error } = await supabase
      .from('tenant_members')
      .select('id, tenant_id, role, name, permissions')
      .eq('user_id', userId)
      .maybeSingle()

    if (error || !data) {
      setMembership(null)
    } else {
      setMembership({
        id: data.id,
        tenantId: data.tenant_id,
        role: data.role as TenantRole,
        name: data.name,
        permissions: data.permissions ?? [],
      })
    }
  }

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user) await loadMembership(data.session.user.id)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      if (nextSession?.user) {
        await loadMembership(nextSession.user.id)
      } else {
        setMembership(null)
      }
      setLoading(false)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function refreshMembership() {
    if (session?.user) await loadMembership(session.user.id)
  }

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, membership, loading, signOut, refreshMembership }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
