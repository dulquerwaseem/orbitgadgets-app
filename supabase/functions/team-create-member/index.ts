import { corsHeaders } from '../_shared/cors.ts'
import { requireTenantAdmin, jsonError, jsonSuccess } from '../_shared/adminAuth.ts'

const ALLOWED_PERMISSIONS = ['invoicing', 'job_sheets', 'inventory', 'vendor_purchases', 'finance']

interface CreateMemberBody {
  email?: string
  password?: string
  name?: string
  role?: string
  permissions?: string[]
}

// Creates the login with the service-role client rather than the normal
// supabase-js signUp flow, so the admin's own browser session is never
// touched — signUp from an already-authenticated browser would otherwise
// swap the local session over to the newly created account.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const auth = await requireTenantAdmin(req)
  if (auth instanceof Response) return auth
  const { adminClient, tenantId } = auth

  let body: CreateMemberBody
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const { email, password, name, role, permissions } = body

  if (!email || !password || !name || !role) {
    return jsonError('email, password, name, and role are required', 400)
  }
  if (role !== 'admin' && role !== 'staff') {
    return jsonError('role must be "admin" or "staff"', 400)
  }

  const safePermissions =
    role === 'staff' && Array.isArray(permissions)
      ? permissions.filter((p) => ALLOWED_PERMISSIONS.includes(p))
      : []

  const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createError || !createdUser.user) {
    return jsonError(createError?.message ?? 'Failed to create user', 400)
  }

  const { error: insertError } = await adminClient.from('tenant_members').insert({
    tenant_id: tenantId,
    user_id: createdUser.user.id,
    email,
    name,
    role,
    permissions: safePermissions,
  })

  if (insertError) {
    // Roll back the auth user so a failed insert doesn't leave an orphaned login.
    await adminClient.auth.admin.deleteUser(createdUser.user.id)
    return jsonError(insertError.message, 400)
  }

  return jsonSuccess()
})
