import clsx from 'clsx'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftRight, Boxes, ClipboardCheck, LayoutDashboard, Lock, LogOut, Menu, ShoppingCart, Store, Tags, Users, X,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useBranches } from '../hooks/queries'
import { useRealtime } from '../hooks/useRealtime'
import type { Role } from '../lib/types'
import { useAuth } from '../store/auth'
import { useBranchStore } from '../store/branch'
import { useLive } from '../store/live'
import { Select } from './ui'

const ALL: Role[] = ['admin', 'manager', 'cashier']
const STAFF: Role[] = ['admin', 'manager']
const NAV = [
  { to: '/pos', label: 'Point of sale', icon: ShoppingCart, roles: ALL },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: STAFF },
  { to: '/inventory', label: 'Inventory', icon: Boxes, roles: ALL },
  { to: '/transfers', label: 'Transfers', icon: ArrowLeftRight, roles: STAFF },
  { to: '/products', label: 'Products', icon: Tags, roles: STAFF },
  { to: '/end-of-day', label: 'End of day', icon: ClipboardCheck, roles: ALL },
  { to: '/branches', label: 'Branches', icon: Store, roles: ['admin'] as Role[] },
  { to: '/staff', label: 'Staff', icon: Users, roles: ['admin'] as Role[] },
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
  const items = NAV.filter((n) => n.roles.includes(user.role))

  const nav = (
    <nav className="flex flex-col gap-0.5 px-3">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-ctl px-3 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'bg-white/10 text-white shadow-[inset_3px_0_0_#59D4A9]' : 'text-white/70 hover:bg-white/5 hover:text-white',
            )
          }
        >
          <Icon size={18} /> {label}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-ink py-5 lg:flex">
        <div className="mb-6 px-6 font-display text-xl font-semibold text-white">VapePOS</div>
        {nav}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-ink/50" />
          <aside className="relative h-full w-64 bg-ink py-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between px-6 font-display text-xl font-semibold text-white">
              VapePOS
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
        <main className="min-w-0 flex-1 p-4 lg:p-6"><Outlet /></main>
      </div>
    </div>
  )
}
