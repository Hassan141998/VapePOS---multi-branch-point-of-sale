import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '../lib/types'

interface AuthState {
  token: string | null
  user: User | null
  login: (token: string, user: User) => void
  logout: () => void
}

/** Session is kept in localStorage so a page refresh does not sign the cashier out. */
export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      login: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'vapepos-auth' },
  ),
)
