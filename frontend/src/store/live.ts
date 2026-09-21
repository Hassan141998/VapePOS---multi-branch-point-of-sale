import { create } from 'zustand'

export type LiveStatus = 'connecting' | 'live' | 'offline' | 'polling'
export const useLive = create<{ status: LiveStatus; set: (s: LiveStatus) => void }>((set) => ({
  status: 'offline',
  set: (status) => set({ status }),
}))
