import { create } from 'zustand'

export interface Toast { id: number; kind: 'success' | 'error'; text: string }
interface ToastState {
  toasts: Toast[]
  push: (kind: Toast['kind'], text: string) => void
  dismiss: (id: number) => void
}
let nextId = 1

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, text) => {
    const id = nextId++
    set({ toasts: [...get().toasts, { id, kind, text }] })
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3500)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = {
  success: (text: string) => useToasts.getState().push('success', text),
  error: (text: string) => useToasts.getState().push('error', text),
}
