import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { hasPermission } from '../lib/permissions'
import type { PermissionKey } from '../lib/permissions'

interface RequirePermissionProps {
  permission: PermissionKey
}

export default function RequirePermission({ permission }: RequirePermissionProps) {
  const { membership } = useAuth()

  if (!hasPermission(membership, permission)) {
    return <Navigate to="/overview" replace />
  }

  return <Outlet />
}
