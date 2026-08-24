import { corsHeaders } from '../_shared/cors.ts'
import { requireTenantAdmin, jsonError, jsonSuccess } from '../_shared/adminAuth.ts'

interface RemoveMemberBody {
  member_id?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const auth = await requireTenantAdmin(req)
  if (auth instanceof Response) return auth
  const { adminClient, tenantId, userId } = auth

  let body: RemoveMemberBody
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const { member_id } = body
  if (!member_id) {
    return jsonError('member_id is required', 400)
  }

  const { data: target, error: targetError } = await adminClient
    .from('tenant_members')
    .select('id, user_id, role')
    .eq('id', member_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (targetError || !target) {
    return jsonError('Member not found', 404)
  }

  if (target.user_id === userId) {
    return jsonError('You cannot remove yourself.', 400)
  }

  if (target.role === 'admin') {
    const { count, error: countError } = await adminClient
      .from('tenant_members')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('role', 'admin')

    if (countError) {
      return jsonError(countError.message, 400)
    }
    if ((count ?? 0) <= 1) {
      return jsonError('Cannot remove the last admin.', 400)
    }
  }

  const { error: deleteMemberError } = await adminClient
    .from('tenant_members')
    .delete()
    .eq('id', target.id)

  if (deleteMemberError) {
    return jsonError(deleteMemberError.message, 400)
  }

  const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(target.user_id)
  if (deleteUserError) {
    return jsonError(`Member removed, but deleting the login failed: ${deleteUserError.message}`, 500)
  }

  return jsonSuccess()
})
