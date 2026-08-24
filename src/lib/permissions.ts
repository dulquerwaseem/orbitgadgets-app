export type PermissionKey = 'invoicing' | 'job_sheets' | 'inventory' | 'vendor_purchases' | 'finance'

export const ALL_PERMISSIONS: PermissionKey[] = [
  'invoicing',
  'job_sheets',
  'inventory',
  'vendor_purchases',
  'finance',
]

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  invoicing: 'Invoicing',
  job_sheets: 'Job Sheets',
  inventory: 'Inventory',
  vendor_purchases: 'Vendor Purchases',
  finance: 'Finance',
}

export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  invoicing: 'Invoices, Quotations, Credit Notes',
  job_sheets: 'Job Sheets',
  inventory: 'Products, Spare Parts',
  vendor_purchases: 'Vendors, Vendor Purchases (view-only)',
  finance: 'Finance (view-only)',
}

interface MembershipLike {
  role: 'admin' | 'staff'
  permissions: string[]
}

export function hasPermission(membership: MembershipLike | null, key: PermissionKey): boolean {
  if (!membership) return false
  if (membership.role === 'admin') return true
  return membership.permissions.includes(key)
}
