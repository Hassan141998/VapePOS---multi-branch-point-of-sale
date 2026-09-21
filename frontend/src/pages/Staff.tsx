import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Pill, Select, Spinner, TableWrap, td, th } from '../components/ui'
import { useBranches } from '../hooks/queries'
import { api, errorMessage } from '../lib/api'
import type { Role, User } from '../lib/types'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'

interface Form { username: string; full_name: string; password: string; role: Role; branch_id: string; is_active: boolean }
const blank: Form = { username: '', full_name: '', password: '', role: 'cashier', branch_id: '', is_active: true }

function UserModal({ user, open, onClose }: { user: User | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const me = useAuth((s) => s.user)
  const { data: branches = [] } = useBranches()
  const [f, setF] = useState<Form>(blank)
  const [error, setError] = useState('')
  const [loadedFor, setLoadedFor] = useState('')
  const key = open ? String(user?.id ?? 'new') : ''
  if (open && key !== loadedFor) {
    setLoadedFor(key); setError('')
    setF(user ? { username: user.username, full_name: user.full_name, password: '', role: user.role, branch_id: user.branch_id?.toString() ?? '', is_active: user.is_active } : blank)
  }
  if (!open && loadedFor) setLoadedFor('')
  const set = (k: keyof Form, v: string | boolean) => setF({ ...f, [k]: v })

  const save = useMutation({
    mutationFn: async () => {
      const branch_id = f.role === 'admin' && !f.branch_id ? null : Number(f.branch_id)
      if (user) {
        return api.put(`/users/${user.id}`, { full_name: f.full_name, role: f.role, branch_id, is_active: f.is_active, ...(f.password ? { password: f.password } : {}) })
      }
      return api.post('/users', { username: f.username, full_name: f.full_name, password: f.password, role: f.role, branch_id, is_active: f.is_active })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success('Account saved'); onClose() },
    onError: (e) => setError(errorMessage(e)),
  })

  return (
    <Modal open={open} onClose={onClose} title={user ? 'Edit account' : 'New account'}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Username"><Input required disabled={!!user} value={f.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" /></Field>
        <Field label="Full name"><Input value={f.full_name} onChange={(e) => set('full_name', e.target.value)} /></Field>
        <Field label={user ? 'New password' : 'Password'} hint={user ? 'Leave empty to keep the current one.' : 'At least 8 characters.'}>
          <Input type="password" minLength={8} maxLength={72} required={!user} value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete="new-password" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <Select value={f.role} onChange={(e) => set('role', e.target.value)}>
              <option value="cashier">Cashier</option><option value="manager">Manager</option><option value="admin">Admin (all branches)</option>
            </Select>
          </Field>
          <Field label="Branch" hint={f.role === 'admin' ? 'Admins can work in every branch.' : 'This account can only work here.'}>
            <Select value={f.branch_id} required={f.role !== 'admin'} onChange={(e) => set('branch_id', e.target.value)}>
              <option value="">{f.role === 'admin' ? 'All branches' : 'Choose a branch'}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[#46307E]" checked={f.is_active} disabled={user?.id === me?.id} onChange={(e) => set('is_active', e.target.checked)} /> Account can sign in
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>Save account</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function Staff() {
  const [editing, setEditing] = useState<User | null>(null)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const { data: all = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: async () => (await api.get<User[]>('/users')).data })
  const q = search.trim().toLowerCase()
  const data = all.filter((u) =>
    (!q || u.username.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q) || (u.branch_name ?? '').toLowerCase().includes(q)) &&
    (!role || u.role === role) && (!status || (status === 'active') === u.is_active))
  return (
    <>
      <PageHeader title="Staff" subtitle="Managers and cashiers can only work in the branch you assign them to." actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> New account</Button>} />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <Input className="!w-64" placeholder="Search name, username, branch" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search staff" />
          <Select className="!w-40" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
            <option value="">All roles</option><option value="admin">Admin</option><option value="manager">Manager</option><option value="cashier">Cashier</option>
          </Select>
          <Select className="!w-40" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option>
          </Select>
          <span className="ml-auto self-center text-sm text-ink-muted">{data.length} of {all.length} accounts</span>
        </div>
        {isLoading ? <Spinner /> : data.length === 0 ? <Empty title="No accounts match" /> : (
          <TableWrap>
            <thead><tr className="border-b border-line bg-paper/60"><th className={th}>Name</th><th className={th}>Username</th><th className={th}>Role</th><th className={th}>Branch</th><th className={th}>Status</th><th className={th}>Joined</th><th className={th} /></tr></thead>
            <tbody className="divide-y divide-line">
              {data.map((u) => (
                <tr key={u.id}>
                  <td className={td}>{u.full_name || '-'}</td>
                  <td className={td}>{u.username}</td>
                  <td className={td}><Pill tone={u.role === 'admin' ? 'purple' : 'neutral'}>{u.role}</Pill></td>
                  <td className={td}>{u.branch_name ?? 'All branches'}</td>
                  <td className={td}>{u.is_active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Disabled</Pill>}</td>
                  <td className={`${td} text-ink-soft`}>{u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}</td>
                  <td className={td}><Button size="sm" variant="secondary" onClick={() => setEditing(u)}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      <UserModal open={creating || !!editing} user={editing} onClose={() => { setCreating(false); setEditing(null) }} />
    </>
  )
}
