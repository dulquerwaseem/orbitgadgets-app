import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  LayoutGrid,
  ReceiptIndianRupee,
  FileText,
  Undo2,
  Wrench,
  Package,
  Cog,
  Truck,
  ShoppingCart,
  Landmark,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import logo from '../assets/orbit-logo.png'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

interface NavGroup {
  label: string | null
  items: NavItem[]
  adminOnly?: boolean
}

const groups: NavGroup[] = [
  { label: null, items: [{ to: '/overview', label: 'Overview', icon: LayoutGrid }] },
  {
    label: 'Sales',
    items: [
      { to: '/invoices', label: 'Invoices', icon: ReceiptIndianRupee },
      { to: '/quotations', label: 'Quotations', icon: FileText },
      { to: '/credit-notes', label: 'Credit Notes', icon: Undo2 },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/job-sheets', label: 'Job Sheets', icon: Wrench },
      { to: '/products', label: 'Products', icon: Package },
      { to: '/spare-parts', label: 'Spare Parts', icon: Cog },
    ],
  },
  {
    label: 'Purchasing',
    items: [
      { to: '/vendors', label: 'Vendors', icon: Truck },
      { to: '/vendor-purchases', label: 'Purchases', icon: ShoppingCart },
    ],
  },
  {
    label: 'Finance',
    adminOnly: true,
    items: [{ to: '/finance', label: 'Finance', icon: Landmark }],
  },
]

export default function Sidebar() {
  const { user, membership, signOut } = useAuth()
  const isAdmin = membership?.role === 'admin'

  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === '1')

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('sidebar-collapsed', next ? '1' : '0')
      return next
    })
  }

  const visibleGroups = groups.filter((group) => !group.adminOnly || isAdmin)

  return (
    <aside
      className={`no-print sticky top-0 flex h-screen flex-col border-r border-slate-200/70 bg-white/70 backdrop-blur transition-[width] duration-200 ${
        collapsed ? 'w-[76px]' : 'w-[256px]'
      }`}
    >
      <div className={`flex items-center border-b border-slate-100 px-5 py-7 ${collapsed ? 'justify-center' : ''}`}>
        {collapsed ? (
          <div
            className="brand-dot h-8 w-8 shrink-0 rounded-full"
            aria-label="Orbit Gadgets"
          />
        ) : (
          <img src={logo} alt="Orbit Gadgets" className="h-12 w-auto" />
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {visibleGroups.map((group, groupIndex) => (
          <div key={group.label ?? `group-${groupIndex}`} className={groupIndex > 0 ? 'mt-5' : ''}>
            {group.label && !collapsed && (
              <p className="mb-1.5 px-3 text-xs font-medium uppercase tracking-wide text-slate-400">
                {group.label}
              </p>
            )}
            {groupIndex > 0 && collapsed && (
              <div className="mx-3 mb-2 border-t border-slate-100" />
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                      collapsed ? 'justify-center' : ''
                    } ${
                      isActive
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="accent-indicator absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full" />
                      )}
                      <item.icon
                        className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`}
                        strokeWidth={2}
                      />
                      {!collapsed && <span>{item.label}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-100 p-3">
        <button
          onClick={toggleCollapsed}
          className={`mb-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={2} />
          ) : (
            <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={2} />
          )}
          {!collapsed && <span>Collapse</span>}
        </button>

        {!collapsed && (
          <div className="mb-2 px-3">
            <p className="truncate text-sm font-medium text-slate-900">{user?.email}</p>
            {membership && <p className="text-xs capitalize text-slate-400">{membership.role}</p>}
          </div>
        )}

        <button
          onClick={() => void signOut()}
          title={collapsed ? 'Log out' : undefined}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <LogOut className="h-[18px] w-[18px]" strokeWidth={2} />
          {!collapsed && <span>Log out</span>}
        </button>
      </div>
    </aside>
  )
}
