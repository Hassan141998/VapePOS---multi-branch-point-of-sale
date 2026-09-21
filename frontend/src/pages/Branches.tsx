import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Pill, Spinner, TableWrap, Textarea, td, th } from '../components/ui'
import { useBranches } from '../hooks/queries'
import { api, errorMessage } from '../lib/api'
import type { Branch } from '../lib/types'
import { toast } from '../store/toast'

interface Form { name: string; code: string; address: string; phone: string; tax_number: string; tax_rate: string; receipt_header_text: string; receipt_footer_text: string; is_active: boolean }
const blank: Form = { name: '', code: '', address: '', phone: '', tax_number: '', tax_rate: '0', receipt_header_text: '', receipt_footer_text: '', is_active: true }

function BranchModal({ branch, open, onClose }: { branch: Branch | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<Form>(blank)
  const [error, setError] = useState('')
  const [loadedFor, setLoadedFor] = useState('')
  const key = open ? String(branch?.id ?? 'new') : ''
  if (open && key !== loadedFor) {
    setLoadedFor(key); setError('')
    setF(branch ? {
      name: branch.name, code: branch.code, address: branch.address ?? '', phone: branch.phone ?? '', tax_number: branch.tax_number ?? '',
      tax_rate: String(branch.tax_rate), receipt_header_text: branch.receipt_header_text ?? '', receipt_footer_text: branch.receipt_footer_text ?? '', is_active: branch.is_active,
    } : blank)
  }
  if (!open && loadedFor) setLoadedFor('')
  const set = (k: keyof Form, v: string | boolean) => setF({ ...f, [k]: v })

  const save = useMutation({
    mutationFn: async () => {
      const body = { ...f, tax_rate: Number(f.tax_rate), address: f.address || null, phone: f.phone || null, tax_number: f.tax_number || null,
        receipt_header_text: f.receipt_header_text || null, receipt_footer_text: f.receipt_footer_text || null }
      return branch ? api.put(`/branches/${branch.id}`, body) : api.post('/branches', body)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['branches'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); toast.success('Branch saved'); onClose() },
    onError: (e) => setError(errorMessage(e)),
  })

  return (
    <Modal open={open} onClose={onClose} title={branch ? 'Edit branch' : 'New branch'} wide>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Branch name"><Input required value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Short code" hint="2-10 letters or digits. Starts every receipt number."><Input required value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} /></Field>
          <Field label="Address" className="sm:col-span-2"><Input value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Tax registration number"><Input value={f.tax_number} onChange={(e) => set('tax_number', e.target.value)} /></Field>
          <Field label="Sales tax rate (%)" hint="Added on top of shelf prices at checkout."><Input type="number" step="0.01" min="0" max="100" value={f.tax_rate} onChange={(e) => set('tax_rate', e.target.value)} /></Field>
        </div>
        <Field label="Receipt header"><Textarea value={f.receipt_header_text} onChange={(e) => set('receipt_header_text', e.target.value)} placeholder="Shop name, address... printed at the top" /></Field>
        <Field label="Receipt footer"><Textarea value={f.receipt_footer_text} onChange={(e) => set('receipt_footer_text', e.target.value)} placeholder="Return policy, age notice, thank-you line" /></Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[#46307E]" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} /> Branch is open for business
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>Save branch</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function Branches() {
  const { data = [], isLoading } = useBranches(true)
  const [editing, setEditing] = useState<Branch | null>(null)
  const [creating, setCreating] = useState(false)
  return (
    <>
      <PageHeader title="Branches" subtitle="Store details, tax rate and receipt wording." actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> New branch</Button>} />
      <Card>
        {isLoading ? <Spinner /> : (
          <TableWrap>
            <thead><tr className="border-b border-line bg-paper/60"><th className={th}>Branch</th><th className={th}>Code</th><th className={th}>Address</th><th className={th}>Tax</th><th className={th}>Status</th><th className={th} /></tr></thead>
            <tbody className="divide-y divide-line">
              {data.map((b) => (
                <tr key={b.id}>
                  <td className={td}><span className="font-medium">{b.name}</span><div className="text-xs text-ink-muted">{b.phone}</div></td>
                  <td className={td}>{b.code}</td>
                  <td className={td}>{b.address ?? '-'}</td>
                  <td className={td}>{b.tax_rate}%</td>
                  <td className={td}>{b.is_active ? <Pill tone="green">Open</Pill> : <Pill tone="neutral">Closed</Pill>}</td>
                  <td className={td}><Button size="sm" variant="secondary" onClick={() => setEditing(b)}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      <BranchModal open={creating || !!editing} branch={editing} onClose={() => { setCreating(false); setEditing(null) }} />
    </>
  )
}
