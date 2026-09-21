import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Pill, Select, Spinner, TableWrap, td, th } from '../components/ui'
import { useCategories } from '../hooks/queries'
import { api, errorMessage } from '../lib/api'
import { catLabel, money } from '../lib/format'
import type { Product } from '../lib/types'
import { useAuth } from '../store/auth'
import { toast } from '../store/toast'

interface Form {
  barcode: string; name: string; brand: string; category: string; flavor: string
  nicotine_type: string; nicotine_strength: string; coil_resistance_ohm: string; device_variant: string
  buying_price: string; selling_price: string; is_active: boolean
}
const blank: Form = {
  barcode: '', name: '', brand: '', category: '', flavor: '', nicotine_type: 'none', nicotine_strength: '',
  coil_resistance_ohm: '', device_variant: '', buying_price: '', selling_price: '', is_active: true,
}
const fromProduct = (p: Product): Form => ({
  barcode: p.barcode, name: p.name, brand: p.brand ?? '', category: p.category ?? '', flavor: p.flavor ?? '',
  nicotine_type: p.nicotine_type, nicotine_strength: p.nicotine_strength ?? '',
  coil_resistance_ohm: p.coil_resistance_ohm?.toString() ?? '', device_variant: p.device_variant ?? '',
  buying_price: String(p.buying_price ?? 0), selling_price: String(p.selling_price), is_active: p.is_active,
})

function ProductModal({ product, open, onClose }: { product: Product | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: categories = [] } = useCategories()
  const [f, setF] = useState<Form>(blank)
  const [error, setError] = useState('')
  const [loadedFor, setLoadedFor] = useState<string>('')
  const key = open ? String(product?.id ?? 'new') : ''
  if (open && key !== loadedFor) { setLoadedFor(key); setF(product ? fromProduct(product) : blank); setError('') }
  if (!open && loadedFor) setLoadedFor('')
  const set = (k: keyof Form, v: string | boolean) => setF({ ...f, [k]: v })

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        barcode: f.barcode.trim(), name: f.name.trim(), brand: f.brand || null, category: f.category || null,
        flavor: f.flavor || null, nicotine_type: f.nicotine_type, nicotine_strength: f.nicotine_strength || null,
        coil_resistance_ohm: f.coil_resistance_ohm ? Number(f.coil_resistance_ohm) : null,
        device_variant: f.device_variant || null, buying_price: Number(f.buying_price), selling_price: Number(f.selling_price),
        is_active: f.is_active,
      }
      return product ? api.put(`/products/${product.id}`, body) : api.post('/products', body)
    },
    onSuccess: () => { for (const k of ['products', 'inventory', 'categories']) qc.invalidateQueries({ queryKey: [k] }); toast.success('Product saved'); onClose() },
    onError: (e) => setError(errorMessage(e)),
  })

  return (
    <Modal open={open} onClose={onClose} title={product ? 'Edit product' : 'New product'} wide>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2"><Input required value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Barcode"><Input required value={f.barcode} onChange={(e) => set('barcode', e.target.value)} /></Field>
          <Field label="Brand"><Input value={f.brand} onChange={(e) => set('brand', e.target.value)} /></Field>
          <Field label="Category" hint={<Link to="/categories" className="text-currant-600 underline-offset-2 hover:underline">Add or edit categories</Link>}>
            <Select value={f.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">None</option>
              {f.category && !categories.some((c) => c.name === f.category) && <option value={f.category}>{catLabel(f.category)}</option>}
              {categories.map((c) => <option key={c.id} value={c.name}>{catLabel(c.name)}</option>)}
            </Select>
          </Field>
          <Field label="Flavor"><Input value={f.flavor} onChange={(e) => set('flavor', e.target.value)} placeholder="Mango Ice" /></Field>
          <Field label="Nicotine type">
            <Select value={f.nicotine_type} onChange={(e) => set('nicotine_type', e.target.value)}>
              <option value="none">None</option><option value="freebase">Freebase</option><option value="salt">Nicotine salt</option>
            </Select>
          </Field>
          <Field label="Nicotine strength"><Input value={f.nicotine_strength} onChange={(e) => set('nicotine_strength', e.target.value)} placeholder="3mg, 20mg, 50mg" /></Field>
          <Field label="Coil resistance (ohm)"><Input type="number" step="0.01" min="0" value={f.coil_resistance_ohm} onChange={(e) => set('coil_resistance_ohm', e.target.value)} placeholder="0.6" /></Field>
          <Field label="Device variant"><Input value={f.device_variant} onChange={(e) => set('device_variant', e.target.value)} placeholder="Matte Black, Kit" /></Field>
          <Field label="Buying price (cost)"><Input type="number" step="0.01" min="0" required value={f.buying_price} onChange={(e) => set('buying_price', e.target.value)} /></Field>
          <Field label="Selling price"><Input type="number" step="0.01" min="0" required value={f.selling_price} onChange={(e) => set('selling_price', e.target.value)} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[#46307E]" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          Sold in stores (untick to hide it from the till)
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>Save product</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function Products() {
  const isAdmin = useAuth((s) => s.user?.role) === 'admin'
  const [params] = useSearchParams()
  const { data: categories = [] } = useCategories()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState(params.get('category') ?? '')
  const [sort, setSort] = useState<'name' | 'price-asc' | 'price-desc' | 'category'>('name')
  const [editing, setEditing] = useState<Product | null>(null)
  const [creating, setCreating] = useState(false)

  const { data: fetched = [], isLoading } = useQuery({
    queryKey: ['products', search, category, isAdmin],
    queryFn: async () => (await api.get<Product[]>('/products', { params: { search: search || undefined, category: category || undefined, include_inactive: isAdmin } })).data,
  })

  const data = useMemo(() => {
    const list = [...fetched]
    if (sort === 'price-asc') list.sort((a, b) => a.selling_price - b.selling_price)
    else if (sort === 'price-desc') list.sort((a, b) => b.selling_price - a.selling_price)
    else if (sort === 'category') list.sort((a, b) => (a.category ?? '~').localeCompare(b.category ?? '~') || a.name.localeCompare(b.name))
    return list
  }, [fetched, sort])

  return (
    <>
      <PageHeader title="Products" subtitle="The shared catalogue. Prices are the same in every branch."
        actions={isAdmin ? <Button onClick={() => setCreating(true)}><Plus size={16} /> New product</Button> : undefined} />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-line p-4">
          <Input className="!w-64" placeholder="Search name, flavor, barcode" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select className="!w-44" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.name}>{catLabel(c.name)}</option>)}
          </Select>
          <Select className="!w-44" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort by">
            <option value="name">Sort: Name</option><option value="price-asc">Sort: Price, low to high</option>
            <option value="price-desc">Sort: Price, high to low</option><option value="category">Sort: Category</option>
          </Select>
        </div>
        {isLoading ? <Spinner /> : data.length === 0 ? <Empty title="No products found" /> : (
          <TableWrap>
            <thead><tr className="border-b border-line bg-paper/60">
              <th className={th}>Product</th><th className={th}>Category</th><th className={th}>Nicotine</th><th className={th}>Barcode</th>
              <th className={th}>Cost</th><th className={th}>Price</th>{isAdmin && <th className={th} />}
            </tr></thead>
            <tbody className="divide-y divide-line">
              {data.map((p) => (
                <tr key={p.id} className={p.is_active ? '' : 'opacity-50'}>
                  <td className={td}>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-ink-muted">{[p.brand, p.flavor, p.coil_resistance_ohm && `${p.coil_resistance_ohm} \u03A9`, p.device_variant].filter(Boolean).join(' \u00B7 ')}</div>
                  </td>
                  <td className={td}>{catLabel(p.category)}</td>
                  <td className={td}>{p.nicotine_strength ? `${p.nicotine_strength} ${p.nicotine_type !== 'none' ? p.nicotine_type : ''}` : '-'}</td>
                  <td className={td}><span className="text-ink-muted">{p.barcode}</span></td>
                  <td className={td}>{money(p.buying_price)}</td>
                  <td className={td}>{money(p.selling_price)} {!p.is_active && <Pill tone="neutral">Hidden</Pill>}</td>
                  {isAdmin && <td className={td}><Button size="sm" variant="secondary" onClick={() => setEditing(p)}>Edit</Button></td>}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      <ProductModal open={creating || !!editing} product={editing} onClose={() => { setCreating(false); setEditing(null) }} />
    </>
  )
}
