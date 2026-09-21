import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button, Card, Empty, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, StatusPill, Textarea } from '../components/ui'
import { useBranches } from '../hooks/queries'
import { api, errorMessage } from '../lib/api'
import { dateTime, statusLabel } from '../lib/format'
import type { InventoryRow, Transfer, TransferStatus } from '../lib/types'
import { useAuth } from '../store/auth'
import { useActiveBranch } from '../store/branch'
import { toast } from '../store/toast'

const FILTERS: (TransferStatus | '')[] = ['', 'pending', 'in_transit', 'received', 'cancelled']

/* ---------------- New transfer ---------------- */
function NewTransfer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useAuth((s) => s.user)!
  const { data: branches = [] } = useBranches()
  const qc = useQueryClient()
  const isAdmin = user.role === 'admin'
  const [fromId, setFromId] = useState<number | ''>(isAdmin ? '' : (user.branch_id ?? ''))
  const [toId, setToId] = useState<number | ''>('')
  const [lines, setLines] = useState<Record<number, number>>({})
  const [search, setSearch] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const source = useQuery({
    queryKey: ['inventory', 'transfer-source', fromId],
    enabled: open && fromId !== '',
    queryFn: async () => (await api.get<InventoryRow[]>('/inventory', { params: { branch_id: fromId } })).data,
  })
  const rows = (source.data ?? []).filter((r) => r.stock_quantity > 0)
  const byId = new Map(rows.map((r) => [r.product.id, r]))
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => !q || [r.product.name, r.product.barcode, r.product.flavor].some((v) => v?.toLowerCase().includes(q))).slice(0, 8)
  }, [rows, search])

  const reset = () => { setLines({}); setSearch(''); setNote(''); setError(''); setToId(''); if (isAdmin) setFromId('') }

  const create = useMutation({
    mutationFn: async () =>
      (await api.post<Transfer>('/transfers', {
        from_branch_id: fromId, to_branch_id: toId, note: note || undefined,
        items: Object.entries(lines).map(([id, quantity]) => ({ product_id: Number(id), quantity })),
      })).data,
    onSuccess: (t) => { qc.invalidateQueries({ queryKey: ['transfers'] }); toast.success(`${t.reference} created`); reset(); onClose() },
    onError: (e) => setError(errorMessage(e)),
  })

  const ready = fromId !== '' && toId !== '' && Object.keys(lines).length > 0 && Object.entries(lines).every(([id, q]) => q > 0 && q <= (byId.get(Number(id))?.stock_quantity ?? 0))

  return (
    <Modal open={open} onClose={onClose} title="New stock transfer" wide>
      <form onSubmit={(e) => { e.preventDefault(); create.mutate() }} className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From (sending branch)">
            <Select value={fromId} disabled={!isAdmin} onChange={(e) => { setFromId(Number(e.target.value)); setLines({}) }} required>
              <option value="" disabled>Choose a branch</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="To (receiving branch)">
            <Select value={toId} onChange={(e) => setToId(Number(e.target.value))} required>
              <option value="" disabled>Choose a branch</option>
              {branches.filter((b) => b.id !== fromId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        </div>

        <div>
          <Field label="Add products"><Input placeholder={fromId === '' ? 'Pick the sending branch first' : 'Search what to send'} disabled={fromId === ''} value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          {fromId !== '' && search.trim() && (
            <ul className="mt-2 divide-y divide-line rounded-ctl border border-line">
              {matches.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">Nothing in stock matches.</li>}
              {matches.map((r) => (
                <li key={r.product.id}>
                  <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-paper"
                    onClick={() => { setLines({ ...lines, [r.product.id]: lines[r.product.id] ?? 1 }); setSearch('') }}>
                    <span>{r.product.name}</span><span className="text-ink-muted">{r.stock_quantity} available</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {Object.keys(lines).length > 0 && (
          <ul className="divide-y divide-line rounded-ctl border border-line">
            {Object.entries(lines).map(([id, qty]) => {
              const r = byId.get(Number(id))
              return (
                <li key={id} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex-1 text-sm">{r?.product.name}<span className="ml-2 text-xs text-ink-muted">{r?.stock_quantity} available</span></span>
                  <Input type="number" min={1} max={r?.stock_quantity} className="!w-24" value={qty}
                    onChange={(e) => setLines({ ...lines, [Number(id)]: Number(e.target.value) })} aria-label="Quantity" />
                  <button type="button" aria-label="Remove" className="text-ink-muted hover:text-brick-600"
                    onClick={() => { const n = { ...lines }; delete n[Number(id)]; setLines(n) }}><Trash2 size={16} /></button>
                </li>
              )
            })}
          </ul>
        )}

        <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Courier, urgency, anything the other branch should know" /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!ready || create.isPending}>Request transfer</Button>
        </div>
      </form>
    </Modal>
  )
}

/* ---------------- Detail with actions ---------------- */
function Detail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const user = useAuth((s) => s.user)!
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const { data: t } = useQuery({
    queryKey: ['transfers', 'one', id],
    enabled: id != null,
    queryFn: async () => (await api.get<Transfer>(`/transfers/${id}`)).data,
  })

  const act = useMutation({
    mutationFn: async (action: 'dispatch' | 'receive' | 'cancel') => (await api.post<Transfer>(`/transfers/${id}/${action}`, {})).data,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['transfers'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      toast.success(`${res.reference} is now ${statusLabel[res.status].toLowerCase()}`)
      setError('')
    },
    onError: (e) => setError(errorMessage(e)),
  })

  const isAdmin = user.role === 'admin'
  const canSource = !!t && (isAdmin || user.branch_id === t.from_branch_id)
  const canDest = !!t && (isAdmin || user.branch_id === t.to_branch_id)

  return (
    <Modal open={id != null} onClose={() => { setError(''); onClose() }} title={t ? t.reference : 'Transfer'} wide>
      {!t ? <Spinner /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 font-medium">{t.from_branch_name} <ArrowRight size={16} className="text-ink-muted" /> {t.to_branch_name}</span>
            <StatusPill status={t.status} />
          </div>
          {t.note && <p className="rounded-ctl bg-paper px-3 py-2 text-sm">{t.note}</p>}
          {error && <ErrorNote>{error}</ErrorNote>}

          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-ink-muted"><th className="py-2 font-medium">Product</th><th className="py-2 text-right font-medium">Quantity</th></tr></thead>
            <tbody className="divide-y divide-line">
              {t.items.map((i) => <tr key={i.product_id}><td className="py-2">{i.product_name}</td><td className="py-2 text-right font-medium">{i.quantity}</td></tr>)}
            </tbody>
          </table>

          <div>
            <h3 className="mb-2 text-sm font-semibold">History</h3>
            <ol className="space-y-2 border-l-2 border-line pl-4">
              {t.events.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-currant-500" />
                  <span className="font-medium">{statusLabel[e.status]}</span> by {e.username ?? 'unknown'}
                  <span className="text-ink-muted"> &middot; {dateTime(e.created_at)}</span>
                  {e.note && <span className="text-ink-muted"> &middot; {e.note}</span>}
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            {(t.status === 'pending' || t.status === 'in_transit') && (canSource || canDest) && (
              <Button variant="danger" disabled={act.isPending} onClick={() => confirm('Cancel this transfer? No stock will move.') && act.mutate('cancel')}>Cancel transfer</Button>
            )}
            {t.status === 'pending' && canSource && <Button disabled={act.isPending} onClick={() => act.mutate('dispatch')}>Mark as sent</Button>}
            {t.status === 'in_transit' && canDest && <Button disabled={act.isPending} onClick={() => act.mutate('receive')}>Confirm delivery received</Button>}
            {t.status === 'pending' && !canSource && <span className="self-center text-sm text-ink-muted">Waiting for {t.from_branch_name} to send it.</span>}
            {t.status === 'in_transit' && !canDest && <span className="self-center text-sm text-ink-muted">Waiting for {t.to_branch_name} to confirm delivery.</span>}
          </div>
        </div>
      )}
    </Modal>
  )
}

/* ---------------- List ---------------- */
export default function Transfers() {
  const { branchId } = useActiveBranch()
  const [filter, setFilter] = useState<TransferStatus | ''>('')
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<number | null>(null)

  const { data = [], isLoading } = useQuery({
    queryKey: ['transfers', 'list', branchId, filter],
    queryFn: async () => (await api.get<Transfer[]>('/transfers', { params: { branch_id: branchId ?? undefined, status: filter || undefined } })).data,
  })

  return (
    <>
      <PageHeader title="Stock transfers" subtitle="Move stock between branches. Counts change when the receiving branch confirms delivery."
        actions={<Button onClick={() => setCreating(true)}><Plus size={16} /> New transfer</Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={clsx('rounded-full border px-3 py-1 text-sm', filter === f ? 'border-currant-600 bg-currant-600 text-white' : 'border-line bg-white text-ink-soft hover:bg-paper')}>
            {f === '' ? 'All' : statusLabel[f]}
          </button>
        ))}
      </div>
      <Card>
        {isLoading ? <Spinner /> : data.length === 0 ? <Empty title="No transfers here">Create one to send stock to another branch.</Empty> : (
          <ul className="divide-y divide-line">
            {data.map((t) => (
              <li key={t.id}>
                <button onClick={() => setOpenId(t.id)} className="flex w-full flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3.5 text-left hover:bg-paper">
                  <span className="w-20 font-display font-semibold">{t.reference}</span>
                  <span className="flex min-w-[220px] items-center gap-2 text-sm">{t.from_branch_name} <ArrowRight size={14} className="text-ink-muted" /> {t.to_branch_name}</span>
                  <span className="text-sm text-ink-muted">{t.items.length} {t.items.length === 1 ? 'product' : 'products'}, {t.items.reduce((s, i) => s + i.quantity, 0)} units</span>
                  <span className="ml-auto flex items-center gap-4"><span className="text-xs text-ink-muted">{dateTime(t.created_at)}</span><StatusPill status={t.status} /></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <NewTransfer open={creating} onClose={() => setCreating(false)} />
      <Detail id={openId} onClose={() => setOpenId(null)} />
    </>
  )
}
