import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { api, errorMessage } from '../lib/api'
import type { User } from '../lib/types'
import { useAuth } from '../store/auth'
import { Button, ErrorNote, Field, Input } from '../components/ui'

export default function Login() {
  const { token, user, login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (token && user) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      // The API expects a classic form post (OAuth2 password flow)
      const body = new URLSearchParams({ username: username.trim(), password })
      const { data } = await api.post<{ access_token: string; user: User }>('/auth/login', body)
      login(data.access_token, data.user)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
        <div className="font-display text-2xl font-semibold">VapePOS</div>
        <div>
          <p className="max-w-md font-display text-4xl font-semibold leading-tight">
            Four counters, one shelf count.
          </p>
          <p className="mt-4 max-w-sm text-white/65">
            Every sale, delivery and transfer updates all branches the moment it happens.
          </p>
        </div>
        <div className="h-1 w-24 rounded-full bg-mint-400" />
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div>
            <h1 className="text-2xl font-semibold">Sign in</h1>
            <p className="mt-1 text-sm text-ink-muted">Use the account your manager gave you.</p>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Field label="Username">
            <Input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Signing in...' : 'Sign in'}</Button>
          {import.meta.env.DEV && (
            <p className="rounded-ctl bg-currant-50 p-3 text-xs text-currant-700">
              Demo data: admin / admin1234, manager1 / manager1234, cashier1 / cashier1234
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
