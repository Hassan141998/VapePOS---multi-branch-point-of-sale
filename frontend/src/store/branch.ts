import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useAuth } from './auth'

interface BranchState {
  /** Admin's choice in the header. null means "All locations". */
  selected: number | null
  select: (id: number | null) => void
}

export const useBranchStore = create<BranchState>()(
  persist((set) => ({ selected: null, select: (id) => set({ selected: id }) }), { name: 'vapepos-branch' }),
)

/**
 * The branch every page should use.
 * Managers and cashiers are locked to their own branch; admins use the header switcher.
 */
export function useActiveBranch() {
  const user = useAuth((s) => s.user)
  const selected = useBranchStore((s) => s.selected)
  const branchId = user?.role === 'admin' ? selected : (user?.branch_id ?? null)
  return { branchId, isAll: branchId === null, locked: user?.role !== 'admin' }
}
