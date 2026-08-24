import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function RequireAdmin() {
  const { membership } = useAuth()

  if (membership?.role !== 'admin') {
    return <Navigate to="/overview" replace />
  }

  return <Outlet />
}
