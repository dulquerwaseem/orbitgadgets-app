import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const links = [
  { to: '/job-sheets', label: 'Job Sheets' },
  { to: '/quotations', label: 'Quotations' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/credit-notes', label: 'Credit Notes' },
  { to: '/products', label: 'Products' },
  { to: '/spare-parts', label: 'Spare Parts' },
  { to: '/vendors', label: 'Vendors' },
  { to: '/vendor-purchases', label: 'Purchases' },
]

const adminOnlyLinks = [{ to: '/finance', label: 'Finance' }]

export default function TopNav() {
  const { user, membership, signOut } = useAuth()
  const visibleLinks =
    membership?.role === 'admin' ? [...links, ...adminOnlyLinks] : links

  return (
    <header className="no-print sticky top-0 z-10 border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <span className="text-lg font-semibold tracking-tight text-slate-900">
            Orbit Gadgets
          </span>
          <nav className="flex items-center gap-1">
            {visibleLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right leading-tight">
            <p className="text-sm font-medium text-slate-900">{user?.email}</p>
            {membership && (
              <p className="text-xs capitalize text-slate-400">{membership.role}</p>
            )}
          </div>
          <button
            onClick={() => void signOut()}
            className="rounded-full border border-slate-200 px-4 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  )
}
