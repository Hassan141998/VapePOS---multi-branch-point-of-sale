import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Spinner, TableWrap, Textarea, td, th } from '../components/ui'
import { useCategories } from '../hooks/queries'
import { api, errorMessage } from '../lib/api'
import { catLabel } from '../lib/format'
import type { Category } from '../lib/types'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'

function CategoryModal({ category, open, onClose }: { category: Category | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [loadedFor, setLoadedFor] = useState('')
  const key = open ? String(category?.id ?? 'new') : ''
  if (open && key !== loadedFor) { setLoadedFor(key); setName(category?.name ?? ''); setDescription(category?.description ?? ''); setError('') }
  if (!open && loadedFor) setLoadedFor('')

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), description: description.trim() || null }
      return category ? api.put(`/categories/${category.id}`, body) : api.post('/categories', body)
    },
    onSuccess: () => {
      for (const k of ['categories', 'products', 'inventory', 'discounts']) qc.invalidateQueries({ queryKey: [k] })
      toast.success(category ? 'Category updated' : 'Category added')
      onClose()
    },
    onError: (e) => setError(errorMessage(e)),
  })

  return (
    <Modal open={open} onClose={onClose} title={category ? 'Edit category' : 'Add category'}>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Name" hint={category && category.product_count > 0 ? `Renaming also moves its ${category.product_count} product(s).` : undefined}>
          <Input required maxLength={50} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Description (optional)"><Textarea maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending || !name.trim()}>Save category</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function Categories() {
  const isAdmin = useAuth((s) => s.user?.role) === 'admin'
  const qc = useQueryClient()
  const { data = [], isLoading } = useCategories()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Category | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Category | null>(null)
  const [deleteError, setDeleteError] = useState('')

  const remove = useMutation({
    mutationFn: async (c: Category) => api.delete(`/categories/${c.id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); toast.success('Category deleted'); setDeleting(null) },
    onError: (e) => setDeleteError(errorMessage(e)),
  })

  const q = search.trim().toLowerCase()
  const rows = data.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q))

  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="Group your products. Every branch shares the same categories."
        actions={isAdmin ? <Button onClick={() => setCreating(true)}><Plus size={16} /> Add category</Button> : undefined}
      />
      <Card>
        <div className="border-b border-line p-4">
          <div className="relative max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <Input className="pl-9" placeholder="Search categories" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search categories" />
          </div>
        </div>
        {isLoading ? <Spinner /> : rows.length === 0 ? (
          <Empty title="No categories found">{isAdmin ? 'Get started by adding your first category.' : 'Ask an admin to add categories.'}</Empty>
        ) : (
          <TableWrap>
            <thead><tr className="border-b border-line bg-paper/60">
              <th className={th}>Name</th><th className={th}>Description</th><th className={th}>Products</th>{isAdmin && <th className={th}>Actions</th>}
            </tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className={td}>
                    <div className="font-medium">{catLabel(c.name)}</div>
                    {catLabel(c.name) !== c.name && <div className="text-xs text-ink-muted">stored as "{c.name}"</div>}
                  </td>
                  <td className={`${td} text-ink-soft`}>{c.description || '-'}</td>
                  <td className={td}>
                    <Link className="text-currant-600 underline-offset-2 hover:underline" to={`/products?category=${encodeURIComponent(c.name)}`}>{c.product_count}</Link>
                  </td>
                  {isAdmin && (
                    <td className={td}>
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`}><Pencil size={14} /> Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setDeleteError(''); setDeleting(c) }} aria-label={`Delete ${c.name}`}><Trash2 size={14} /></Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <CategoryModal open={creating || !!editing} category={editing} onClose={() => { setCreating(false); setEditing(null) }} />
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete category">
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm">Delete <strong>{catLabel(deleting.name)}</strong>? Products keep working, but a category can only be deleted when no product uses it.</p>
            {deleteError && <ErrorNote>{deleteError}</ErrorNote>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(deleting)}>Delete category</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
