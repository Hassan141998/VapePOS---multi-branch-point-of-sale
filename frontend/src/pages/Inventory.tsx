import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Pill, Select, Spinner, TableWrap, td, th } from '../components/ui'
import { useCategories } from '../hooks/queries'
import { api, errorMessage } from '../lib/api'
import { catLabel } from '../lib/format'
import type { InventoryRow, Product } from '../lib/types'
import { useAuth } from '../store/auth'
import { useActiveBranch } from '../store/branch'
import { toast } from '../store/toast'

function details(p: Product) {
  return [p.flavor, p.nicotine_strength && `${p.nicotine_strength} ${p.nicotine_type !== 'none' ? p.nicotine_type : ''}`.trim(),
    p.coil_resistance_ohm && `${p.coil_resistance_ohm} \u03A9`, p.device_variant].filter(Boolean).join(' \u00B7 ')
}

function AdjustModal({ row, onClose }: { row: InventoryRow | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [count, setCount] = useState('')
  const [minimum, setMinimum] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  // reset the form whenever a different cell is opened
  const key = row ? `${row.product.id}-${row.branch_id}` : ''
  const [lastKey, setLastKey] = useState('')
  if (row && key !== lastKey) {
    setLastKey(key); setCount(String(row.stock_quantity)); setMinimum(String(row.min_threshold)); setNote(''); setError('')
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!row) return
      if (Number(count) !== row.stock_quantity) {
        await api.post('/inventory/adjust', { branch_id: row.branch_id, product_id: row.product.id, set_to: Number(count), note: note || undefined })
      }
      if (Number(minimum) !== row.min_threshold) {
        await api.put(`/inventory/${row.branch_id}/${row.product.id}/threshold`, { min_threshold: Number(minimum) })
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); toast.success('Stock updated'); onClose() },
    onError: (e) => setError(errorMessage(e)),
  })

  return (
    <Modal open={!!row} onClose={onClose} title="Update stock">
      {row && (
        <form onSubmit={(e) => { e.preventDefault(); save.mutate() }} className="space-y-4">
          <div>
            <p className="font-medium">{row.product.name}</p>
            <p className="text-sm text-ink-muted">{row.branch_name} &middot; currently {row.stock_quantity} in stock</p>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Counted stock"><Input type="number" min={0} required value={count} onChange={(e) => setCount(e.target.value)} /></Field>
            <Field label="Low-stock alert at" hint="Warn when stock is this low or lower"><Input type="number" min={0} required value={minimum} onChange={(e) => setMinimum(e.target.value)} /></Field>
          </div>
          <Field label="Reason (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Delivery from supplier, stock take, damaged..." /></Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>Save changes</Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

export default function Inventory() {
  const user = useAuth((s) => s.user)!
  const { branchId } = useActiveBranch()
  const [params] = useSearchParams()
  const { data: categories = [] } = useCategories()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState<'all' | 'in' | 'low' | 'out'>(params.get('low') === '1' ? 'low' : 'all')
  const [editing, setEditing] = useState<InventoryRow | null>(null)
  const canEdit = user.role !== 'cashier'

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['inventory', 'list', branchId],
    queryFn: async () => (await api.get<InventoryRow[]>('/inventory', { params: { branch_id: branchId ?? undefined } })).data,
  })

  const { branchCols, products } = useMemo(() => {
    const cols = new Map<number, string>()
    const map = new Map<number, { product: Product; cells: Map<number, InventoryRow> }>()
    for (const r of rows) {
      cols.set(r.branch_id, r.branch_name)
      const entry = map.get(r.product.id) ?? { product: r.product, cells: new Map() }
      entry.cells.set(r.branch_id, r)
      map.set(r.product.id, entry)
    }
    const q = search.trim().toLowerCase()
    const list = [...map.values()].filter(({ product: p, cells }) => {
      if (category && p.category !== category) return false
      const cellList = [...cells.values()]
      if (status === 'low' && !cellList.some((c) => c.is_low)) return false
      if (status === 'out' && !cellList.some((c) => c.stock_quantity === 0)) return false
      if (status === 'in' && !cellList.some((c) => c.stock_quantity > 0)) return false
      if (!q) return true
      return [p.name, p.barcode, p.flavor, p.brand].some((v) => v?.toLowerCase().includes(q))
    })
    return { branchCols: [...cols.entries()].sort((a, b) => a[0] - b[0]), products: list }
  }, [rows, search, category, status])

  const summary = useMemo(() => ({
    products: new Set(rows.map((r) => r.product.id)).size,
    units: rows.reduce((sum, r) => sum + r.stock_quantity, 0),
    low: rows.filter((r) => r.is_low && r.stock_quantity > 0).length,
    out: rows.filter((r) => r.stock_quantity === 0).length,
  }), [rows])

  return (
    <>
      <PageHeader title="Inventory" subtitle={branchId == null ? 'Stock at every location' : 'Stock on this branch\u2019s shelves'} />
      <Card className="mb-5 grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        {[
          ['Products', summary.products, 'In the catalogue'],
          ['Units in stock', summary.units, branchId == null ? 'Across all locations' : 'On this branch\u2019s shelves'],
          ['Low stock', summary.low, 'At or below their alert level'],
          ['Out of stock', summary.out, 'Nothing left to sell'],
        ].map(([label, value, note]) => (
          <div key={label as string} className="px-5 py-4">
            <div className="text-sm text-ink-muted">{label}</div>
            <div className="mt-1 font-display text-2xl font-semibold tracking-tight">{isLoading ? '-' : (value as number).toLocaleString()}</div>
            <div className="mt-0.5 text-xs text-ink-muted">{note}</div>
          </div>
        ))}
      </Card>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <Input className="!w-64" placeholder="Search name, flavor, barcode" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select className="!w-44" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.name}>{catLabel(c.name)}</option>)}
          </Select>
          <Select className="!w-44" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Stock level">
            <option value="all">All stock levels</option><option value="in">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option>
          </Select>
          <span className="ml-auto text-sm text-ink-muted">{products.length} products</span>
        </div>
        {isLoading ? <Spinner /> : products.length === 0 ? (
          <Empty title="No products match">{status !== 'all' ? 'No products have this stock level right now.' : 'Try clearing the search or category.'}</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr className="border-b border-line bg-paper/60">
                <th className={th}>Product</th>
                {branchCols.map(([id, name]) => <th key={id} className={clsx(th, 'text-center')}>{name}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {products.map(({ product: p, cells }) => (
                <tr key={p.id}>
                  <td className={td}>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-ink-muted">{details(p) || p.barcode}</div>
                  </td>
                  {branchCols.map(([id]) => {
                    const c = cells.get(id)
                    if (!c) return <td key={id} className={clsx(td, 'text-center text-ink-muted')}>-</td>
                    const tone = c.stock_quantity === 0 ? 'red' : c.is_low ? 'amber' : 'green'
                    return (
                      <td key={id} className={clsx(td, 'text-center')}>
                        <button
                          disabled={!canEdit}
                          onClick={() => setEditing(c)}
                          className={clsx('rounded-ctl px-2 py-1', canEdit && 'hover:bg-paper')}
                          title={canEdit ? 'Update stock' : undefined}
                        >
                          <Pill tone={tone}>{c.stock_quantity}</Pill>
                          <div className="mt-0.5 text-[11px] text-ink-muted">alert at {c.min_threshold}</div>
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      <AdjustModal row={editing} onClose={() => setEditing(null)} />
    </>
  )
}
