import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Pill, Select, Spinner, TableWrap, td, th } from '../components/ui'
import { useAllProducts, useCategories, useDiscounts } from '../hooks/queries'
import { api, errorMessage } from '../lib/api'
import { catLabel, discountValue, money } from '../lib/format'
import type { Discount, DiscountScope, DiscountStatus, DiscountType } from '../lib/types'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'

interface Form {
  name: string; code: string; type: DiscountType; value: string; applies_to: DiscountScope
  category: string; product_id: string; min_purchase: string; starts_on: string; ends_on: string; is_active: boolean
}
const blank: Form = {
  name: '', code: '', type: 'percent', value: '10', applies_to: 'all', category: '', product_id: '',
  min_purchase: '0', starts_on: '', ends_on: '', is_active: true,
}
const fromDiscount = (d: Discount): Form => ({
  name: d.name, code: d.code, type: d.type, value: String(d.value), applies_to: d.applies_to, category: d.category ?? '',
  product_id: d.product_id?.toString() ?? '', min_purchase: String(d.min_purchase), starts_on: d.starts_on ?? '', ends_on: d.ends_on ?? '', is_active: d.is_active,
})

const statusTone: Record<DiscountStatus, 'green' | 'purple' | 'neutral' | 'red'> = { active: 'green', scheduled: 'purple', expired: 'red', disabled: 'neutral' }
const statusText: Record<DiscountStatus, string> = { active: 'Active', scheduled: 'Scheduled', expired: 'Expired', disabled: 'Disabled' }

const discountScope = (d: Pick<Discount, 'applies_to' | 'category' | 'product_name'>) =>
  d.applies_to === 'all' ? 'All items' : d.applies_to === 'category' ? `Category: ${catLabel(d.category)}` : `Product: ${d.product_name ?? '-'}`

function DiscountModal({ discount, open, onClose }: { discount: Discount | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: categories = [] } = useCategories()
  const { data: products = [] } = useAllProducts()
  const [f, setF] = useState<Form>(blank)
  const [error, setError] = useState('')
  const [loadedFor, setLoadedFor] = useState('')
  const key = open ? String(discount?.id ?? 'new') : ''
  if (open && key !== loadedFor) { setLoadedFor(key); setF(discount ? fromDiscount(discount) : blank); setError('') }
  if (!open && loadedFor) setLoadedFor('')
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v })

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name.trim(), code: f.code.trim().toUpperCase(), type: f.type, value: Number(f.value), applies_to: f.applies_to,
        category: f.applies_to === 'category' ? f.category || null : null,
        product_id: f.applies_to === 'product' && f.product_id ? Number(f.product_id) : null,
        min_purchase: Number(f.min_purchase || 0), starts_on: f.starts_on || null, ends_on: f.ends_on || null, is_active: f.is_active,
      }
      return discount ? api.put(`/discounts/${discount.id}`, body) : api.post('/discounts', body)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['discounts'] }); toast.success('Discount saved'); onClose() },
    onError: (e) => setError(errorMessage(e)),
  })

  return (
    <Modal open={open} onClose={onClose} title={discount ? 'Edit discount' : 'Add discount'} wide>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input required maxLength={100} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Summer sale" autoFocus /></Field>
          <Field label="Code" hint="What the cashier picks or types. Letters, digits, - and _.">
            <Input required minLength={2} maxLength={40} pattern="[A-Za-z0-9_\-]+" value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="SUMMER10" />
          </Field>
          <Field label="Type">
            <Select value={f.type} onChange={(e) => set('type', e.target.value as DiscountType)}>
              <option value="percent">Percentage (%)</option><option value="fixed">Fixed amount</option>
            </Select>
          </Field>
          <Field label={f.type === 'percent' ? 'Percent off' : 'Amount off'}>
            <Input required type="number" min="0.01" max={f.type === 'percent' ? 100 : undefined} step="0.01" value={f.value} onChange={(e) => set('value', e.target.value)} />
          </Field>
          <Field label="Applies to">
            <Select value={f.applies_to} onChange={(e) => set('applies_to', e.target.value as DiscountScope)}>
              <option value="all">All items</option><option value="category">One category</option><option value="product">One product</option>
            </Select>
          </Field>
          {f.applies_to === 'category' && (
            <Field label="Category">
              <Select required value={f.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">Choose a category</option>
                {categories.map((c) => <option key={c.id} value={c.name}>{catLabel(c.name)}</option>)}
              </Select>
            </Field>
          )}
          {f.applies_to === 'product' && (
            <Field label="Product">
              <Select required value={f.product_id} onChange={(e) => set('product_id', e.target.value)}>
                <option value="">Choose a product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Minimum purchase" hint="Eligible items must add up to at least this much. 0 means no minimum.">
            <Input type="number" min="0" step="0.01" value={f.min_purchase} onChange={(e) => set('min_purchase', e.target.value)} />
          </Field>
          <Field label="Starts on (optional)"><Input type="date" value={f.starts_on} onChange={(e) => set('starts_on', e.target.value)} /></Field>
          <Field label="Ends on (optional)"><Input type="date" min={f.starts_on || undefined} value={f.ends_on} onChange={(e) => set('ends_on', e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[#46307E]" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          Available at the till
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>Save discount</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function Discounts() {
  const isAdmin = useAuth((s) => s.user?.role) === 'admin'
  const qc = useQueryClient()
  const { data = [], isLoading } = useDiscounts()
  const [editing, setEditing] = useState<Discount | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Discount | null>(null)

  const remove = useMutation({
    mutationFn: async (d: Discount) => api.delete(`/discounts/${d.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['discounts'] }); toast.success('Discount deleted'); setDeleting(null) },
    onError: (e) => { toast.error(errorMessage(e)); setDeleting(null) },
  })

  return (
    <>
      <PageHeader
        title="Discounts"
        subtitle="Promotions your cashiers can apply at the till."
        actions={isAdmin ? <Button onClick={() => setCreating(true)}><Plus size={16} /> Add discount</Button> : undefined}
      />
      <Card>
        <h2 className="border-b border-line px-5 py-3 text-base font-semibold">Discounts</h2>
        {isLoading ? <Spinner /> : data.length === 0 ? (
          <Empty title="No discounts found">{isAdmin ? 'Create your first discount to start offering promotions to customers.' : 'No promotions have been set up yet.'}</Empty>
        ) : (
          <TableWrap>
            <thead><tr className="border-b border-line bg-paper/60">
              <th className={th}>Name</th><th className={th}>Code</th><th className={th}>Value</th><th className={th}>Applies to</th>
              <th className={th}>Valid</th><th className={th}>Status</th>{isAdmin && <th className={th}>Actions</th>}
            </tr></thead>
            <tbody className="divide-y divide-line">
              {data.map((d) => (
                <tr key={d.id} className={d.status === 'active' ? '' : 'opacity-70'}>
                  <td className={`${td} font-medium`}>{d.name}</td>
                  <td className={td}><code className="rounded bg-paper px-1.5 py-0.5 text-xs">{d.code}</code></td>
                  <td className={td}>{discountValue(d)}</td>
                  <td className={td}>
                    {discountScope(d)}
                    {d.min_purchase > 0 && <div className="text-xs text-ink-muted">min. {money(d.min_purchase)}</div>}
                  </td>
                  <td className={`${td} text-ink-soft`}>{d.starts_on || d.ends_on ? `${d.starts_on ?? '...'} to ${d.ends_on ?? '...'}` : 'Always'}</td>
                  <td className={td}><Pill tone={statusTone[d.status]}>{statusText[d.status]}</Pill></td>
                  {isAdmin && (
                    <td className={td}>
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`}><Pencil size={14} /> Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(d)} aria-label={`Delete ${d.name}`}><Trash2 size={14} /></Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <DiscountModal open={creating || !!editing} discount={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete discount">
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm">Delete <strong>{deleting.name}</strong> ({deleting.code})? Receipts already printed keep their discount details.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(deleting)}>Delete discount</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
