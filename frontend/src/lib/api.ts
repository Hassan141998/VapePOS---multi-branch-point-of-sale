import axios, { AxiosError } from 'axios'
import { useAuth } from '../store/auth'

/**
 * Where the API lives.
 *  - Empty (default): same address as the website. Vite proxies /api in development, nginx does in Docker.
 *  - VITE_API_URL=https://my-api.example.com : the API is on another host (Vercel + separate API).
 */
export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '')

export const api = axios.create({ baseURL: `${API_URL}/api/v1` })

api.interceptors.request.use((config) => {
  const token = useAuth.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (error: AxiosError) => {
    // Session expired or account disabled: go back to the login screen.
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      useAuth.getState().logout()
    }
    return Promise.reject(error)
  },
)

/** Turn any API error into a short sentence a cashier can act on. */
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && detail.length) {
      return detail.map((d: { loc?: string[]; msg: string }) => `${d.loc?.slice(1).join('.') ?? ''} ${d.msg}`.trim()).join('; ')
    }
    if (!error.response) return 'Cannot reach the server. Check your connection and try again.'
  }
  return 'Something went wrong. Please try again.'
}
