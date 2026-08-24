import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from './cors.ts'

export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function jsonSuccess(body: unknown = { success: true }): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

interface AdminAuthContext {
  adminClient: ReturnType<typeof createClient>
  userId: string
  tenantId: string
}

// Verifies the caller's JWT identifies a tenant admin, then hands back a
// service-role client for the actual privileged work. The service role client
// is only ever created here, after the admin check passes.
export async function requireTenantAdmin(req: Request): Promise<AdminAuthContext | Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonError('Missing authorization header', 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData.user) {
    return jsonError('Invalid session', 401)
  }

  const { data: membership, error: membershipError } = await callerClient
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (membershipError || !membership || membership.role !== 'admin') {
    return jsonError('Admin access required', 403)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  return { adminClient, userId: userData.user.id, tenantId: membership.tenant_id as string }
}
