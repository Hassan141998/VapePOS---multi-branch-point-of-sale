import clsx from 'clsx'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftRight, BarChart3, Barcode, Boxes, ClipboardCheck, DatabaseBackup, FolderTree, LayoutDashboard, Lock, LogOut, Menu,
  Percent, ReceiptText, ScanBarcode, Settings, ShoppingCart, Store, Tags, Users, X,
} from 'lucide-react'
import { Suspense, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useBranches, useSettings } from '../hooks/queries'
import { useRealtime } from '../hooks/useRealtime'
import { setCurrency } from '../lib/format'
import type { Role } from '../lib/types'
import { useAuth } from '../store/auth'
import { useBranchStore } from '../store/branch'
import { useLive } from '../store/live'
import { Select, Spinner } from './ui'

const ALL: Role[] = ['admin', 'manager', 'cashier']
const STAFF: Role[] = ['admin', 'manager']
const ADMIN: Role[] = ['admin']
const SECTIONS = [
  {
    title: 'Main',
    items: [
      { to: '/pos', label: 'Point of sale', icon: ShoppingCart, roles: ALL },
      { to: '/sales', label: 'Sales', icon: ReceiptText, roles: ALL },
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: STAFF },
      { to: '/products', label: 'Products', icon: Tags, roles: STAFF },
      { to: '/categories', label: 'Categories', icon: FolderTree, roles: STAFF },
      { to: '/discounts', label: 'Discounts', icon: Percent, roles: STAFF },
      { to: '/inventory', label: 'Inventory', icon: Boxes, roles: ALL },
      { to: '/transfers', label: 'Transfers', icon: ArrowLeftRight, roles: STAFF },
    ],
  },
  {
    title: 'Tools',
    items: [
      { to: '/barcode-designer', label: 'Barcode Designer', icon: Barcode, roles: STAFF },
      { to: '/barcode-generator', label: 'Barcode Generator', icon: ScanBarcode, roles: STAFF },
      { to: '/receipt-designer', label: 'Receipt Designer', icon: ReceiptText, roles: ADMIN },
    ],
  },
  {
    title: 'Reports',
    items: [
      { to: '/reports', label: 'Reports', icon: BarChart3, roles: STAFF },
      { to: '/end-of-day', label: 'End of day', icon: ClipboardCheck, roles: ALL },
      { to: '/data-export', label: 'Data Export', icon: DatabaseBackup, roles: ADMIN },
    ],
  },
  {
    title: 'Manage',
    items: [
      { to: '/branches', label: 'Branches', icon: Store, roles: ADMIN },
      { to: '/staff', label: 'Staff', icon: Users, roles: ADMIN },
      { to: '/settings', label: 'System Settings', icon: Settings, roles: ADMIN },
    ],
  },
]

function BranchSwitcher() {
  const user = useAuth((s) => s.user)!
  const { data: branches = [] } = useBranches()
  const selected = useBranchStore((s) => s.selected)
  const select = useBranchStore((s) => s.select)

  if (user.role !== 'admin') {
    return (
      <div className="flex items-center gap-2 rounded-ctl border border-line bg-white px-3 py-1.5 text-sm" title="Your account is locked to this branch">
        <Lock size={14} className="text-ink-muted" />
        <span className="font-medium">{user.branch_name}</span>
      </div>
    )
  }
  return (
    <Select
      aria-label="Location"
      className="!w-auto min-w-[180px] font-medium"
      value={selected ?? ''}
      onChange={(e) => select(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">All locations</option>
      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </Select>
  )
}

function LiveDot() {
  const status = useLive((s) => s.status)
  const label = status === 'live' ? 'Live' : status === 'polling' ? 'Auto-refresh' : status === 'connecting' ? 'Connecting' : 'Reconnecting'
  return (
    <span className="hidden items-center gap-1.5 text-xs text-ink-muted sm:flex" title="Screens stay up to date with the other branches">
      <span className={clsx('h-2 w-2 rounded-full', status === 'live' || status === 'polling' ? 'bg-mint-600' : 'bg-amber-700')} />
      {label}
    </span>
  )
}

export default function Layout() {
  useRealtime()
  const user = useAuth((s) => s.user)!
  const logout = useAuth((s) => s.logout)
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { business } = useSettings()
  // The shop's currency comes from System Settings; the key changes with it so open pages redraw their prices.
  const currencyKey = setCurrency(business.currency, business.currency_symbol)
  const sections = SECTIONS
    .map((sec) => ({ ...sec, items: sec.items.filter((n) => n.roles.includes(user.role)) }))
    .filter((sec) => sec.items.length > 0)

  const nav = (
    <nav className="flex flex-col gap-4 overflow-y-auto px-3 pb-4">
      {sections.map((sec) => (
        <div key={sec.title}>
          <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">{sec.title}</div>
          <div className="flex flex-col gap-0.5">
            {sec.items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 rounded-ctl px-3 py-2 text-sm font-medium transition-colors',
                    isActive ? 'bg-white/10 text-white shadow-[inset_3px_0_0_#59D4A9]' : 'text-white/70 hover:bg-white/5 hover:text-white',
                  )
                }
              >
                <Icon size={18} /> {label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-ink pt-5 lg:flex">
        <div className="mb-5 truncate px-6 font-display text-xl font-semibold text-white" title={business.business_name}>{business.business_name}</div>
        {nav}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-ink/50" />
          <aside className="relative flex h-full w-64 flex-col bg-ink pt-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between px-6 font-display text-xl font-semibold text-white">
              <span className="truncate">{business.business_name}</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu"><X size={20} /></button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-paper/95 px-4 py-2.5 backdrop-blur lg:px-6">
          <button className="rounded-ctl p-2 hover:bg-ink/5 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <BranchSwitcher />
          <div className="ml-auto flex items-center gap-4">
            <LiveDot />
            <div className="text-right text-sm leading-tight">
              <div className="font-medium">{user.full_name || user.username}</div>
              <div className="text-xs capitalize text-ink-muted">{user.role}</div>
            </div>
            <button
              onClick={() => { logout(); qc.clear() }}
              className="rounded-ctl p-2 text-ink-muted hover:bg-ink/5 hover:text-ink"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-6"><Suspense fallback={<Spinner />}><Outlet key={currencyKey} /></Suspense></main>
      </div>
    </div>
  )
}
