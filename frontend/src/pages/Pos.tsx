import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Minus, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Receipt } from '../components/Receipt'
import { Button, Card, Empty, Input, Modal, Pill, Spinner } from '../components/ui'
import { useBranches } from '../hooks/queries'
import { api, errorMessage } from '../lib/api'
import { CATEGORIES, categoryLabel, money } from '../lib/format'
import type { InventoryRow, PaymentMethod, Product, Sale } from '../lib/types'
import { useActiveBranch } from '../store/branch'
import { toast } from '../store/toast'

const cents = (n: number) => Math.round(n * 100)

function attributes(p: Product): string[] {
  const out: string[] = []
  if (p.flavor) out.push(p.flavor)
  if (p.nicotine_strength) out.push(`${p.nicotine_strength}${p.nicotine_type !== 'none' ? ' ' + p.nicotine_type : ''}`)
  if (p.coil_resistance_ohm) out.push(`${p.coil_resistance_ohm} \u03A9`)
  if (p.device_variant) out.push(p.device_variant)
  return out
}

export default function Pos() {
  const { branchId } = useActiveBranch()
  const { data: branches = [] } = useBranches()
  const branch = branches.find((b) => b.id === branchId)
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string>('')
  const [cart, setCart] = useState<Record<number, number>>({})
  const [method, setMethod] = useState<PaymentMethod>('card')
  const [tendered, setTendered] = useState('')
  const [sale, setSale] = useState<Sale | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const inventory = useQuery({
    queryKey: ['inventory', 'pos', branchId],
    enabled: branchId != null,
    queryFn: async () => (await api.get<InventoryRow[]>('/inventory', { params: { branch_id: branchId } })).data,
  })
  const rows = inventory.data ?? []
  const byId = useMemo(() => new Map(rows.map((r) => [r.product.id, r])), [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(({ product: p }) => {
      if (category && p.category !== category) return false
      if (!q) return true
      return [p.name, p.barcode, p.flavor, p.brand].some((v) => v?.toLowerCase().includes(q))
    })
  }, [rows, search, category])

  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ row: byId.get(Number(id)), qty }))
    .filter((l): l is { row: InventoryRow; qty: number } => !!l.row)

  const subtotal = lines.reduce((s, l) => s + cents(l.row.product.selling_price) * l.qty, 0)
  const taxRate = branch?.tax_rate ?? 0
  const tax = Math.round((subtotal * taxRate) / 100)
  const total = subtotal + tax
  const tenderedCents = tendered === '' ? total : cents(Number(tendered))
  const short = method === 'cash' && tenderedCents < total
  const overStock = lines.some((l) => l.qty > l.row.stock_quantity)

  const add = (row: InventoryRow) => {
    const inCart = cart[row.product.id] ?? 0
    if (inCart >= row.stock_quantity) {
      toast.error(`Only ${row.stock_quantity} of ${row.product.name} in stock.`)
      return
    }
    setCart({ ...cart, [row.product.id]: inCart + 1 })
  }
  const setQty = (id: number, qty: number) => {
    const next = { ...cart }
    if (qty <= 0) delete next[id]
    else next[id] = qty
    setCart(next)
  }
  const clear = () => { setCart({}); setTendered('') }

  const onSearchEnter = () => {
    const q = search.trim()
    if (!q) return
    // A barcode scanner types the code and presses Enter: exact barcode wins.
    const exact = rows.find((r) => r.product.barcode === q)
    const target = exact ?? (visible.length === 1 ? visible[0] : undefined)
    if (target) { add(target); setSearch('') }
    else toast.error('No product matches that code.')
  }

  const checkout = useMutation({
    mutationFn: async () =>
      (await api.post<Sale>('/sales', {
        items: lines.map((l) => ({ product_id: l.row.product.id, quantity: l.qty })),
        payment_method: method,
        amount_tendered: method === 'cash' ? tenderedCents / 100 : undefined,
      })).data,
    onSuccess: (data) => {
      setSale(data)
      clear()
      qc.invalidateQueries({ queryKey: ['inventory'] })
      searchRef.current?.focus()
    },
    onError: (e) => {
      toast.error(errorMessage(e))
      qc.invalidateQueries({ queryKey: ['inventory'] })
    },
  })

  if (branchId == null) {
    return (
      <Card><Empty title="Choose a location to start selling">Use the location menu at the top of the screen to pick the store you are working in.</Empty></Card>
    )
  }

  const quick = [...new Set([total, ...[5, 10, 20, 50, 100].map((step) => Math.ceil(total / (step * 100)) * step * 100)])]
    .filter((v) => v >= total).slice(0, 4)

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* ---------- Catalogue ---------- */}
      <div className="min-w-0">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <Input
            ref={searchRef}
            autoFocus
            className="!py-3 pl-9 text-base"
            placeholder="Scan a barcode or search by name, flavor or brand"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearchEnter()}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {['', ...CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={clsx(
                'rounded-full border px-3 py-1 text-sm transition-colors',
                category === c ? 'border-currant-600 bg-currant-600 text-white' : 'border-line bg-white text-ink-soft hover:bg-paper',
              )}
            >
              {c === '' ? 'Everything' : categoryLabel[c]}
            </button>
          ))}
        </div>

        {inventory.isLoading ? <Spinner /> : visible.length === 0 ? (
          <Card className="mt-4"><Empty title="Nothing found">Try a different word, or clear the category filter.</Empty></Card>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {visible.map((row) => {
              const p = row.product
              const out = row.stock_quantity <= 0
              return (
                <button
                  key={p.id}
                  disabled={out}
                  onClick={() => add(row)}
                  className={clsx(
                    'flex flex-col rounded-panel border bg-white p-3 text-left transition-colors',
                    out ? 'border-line opacity-55' : 'border-line hover:border-currant-500 active:bg-currant-50',
                  )}
                >
                  <span className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-5">{p.name}</span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    {attributes(p).slice(0, 3).map((a) => <Pill key={a} tone="neutral">{a}</Pill>)}
                  </span>
                  <span className="mt-auto flex items-end justify-between pt-3">
                    <span className="font-display text-lg font-semibold">{money(p.selling_price)}</span>
                    {out ? <Pill tone="red">Out</Pill> : row.is_low ? <Pill tone="amber">{row.stock_quantity} left</Pill> : <span className="text-xs text-ink-muted">{row.stock_quantity} in stock</span>}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ---------- The ticket ---------- */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="border-x border-t border-line bg-white">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <h2 className="text-lg font-semibold leading-tight">Current sale</h2>
              <p className="text-xs text-ink-muted">{branch?.name}</p>
            </div>
            {lines.length > 0 && <button onClick={clear} className="text-sm text-ink-muted underline-offset-2 hover:underline">Clear</button>}
          </div>

          <div className="border-t border-dashed border-ink/30 px-4">
            {lines.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-muted">Scan or tap a product to add it.</p>
            ) : (
              <ul className="divide-y divide-line">
                {lines.map(({ row, qty }) => (
                  <li key={row.product.id} className="py-3">
                    <div className="flex justify-between gap-3">
                      <span className="text-sm font-medium leading-5">{row.product.name}</span>
                      <span className="text-sm font-medium">{money((cents(row.product.selling_price) * qty) / 100)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <button aria-label="Remove one" className="rounded-ctl border border-line p-1.5 hover:bg-paper" onClick={() => setQty(row.product.id, qty - 1)}><Minus size={14} /></button>
                        <span className="w-8 text-center text-sm font-medium">{qty}</span>
                        <button aria-label="Add one" className="rounded-ctl border border-line p-1.5 hover:bg-paper" onClick={() => add(row)}><Plus size={14} /></button>
                      </div>
                      <div className="flex items-center gap-3">
                        {qty > row.stock_quantity && <Pill tone="red">Only {row.stock_quantity} in stock</Pill>}
                        <span className="text-xs text-ink-muted">{money(row.product.selling_price)} each</span>
                        <button aria-label="Remove line" className="text-ink-muted hover:text-brick-600" onClick={() => setQty(row.product.id, 0)}><Trash2 size={15} /></button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1 border-t border-dashed border-ink/30 px-4 py-3 text-sm">
            <div className="flex justify-between text-ink-soft"><span>Subtotal</span><span>{money(subtotal / 100)}</span></div>
            <div className="flex justify-between text-ink-soft"><span>Tax ({taxRate}%)</span><span>{money(tax / 100)}</span></div>
            <div className="flex items-baseline justify-between pt-1">
              <span className="font-medium">Total</span>
              <span className="font-display text-3xl font-semibold tracking-tight">{money(total / 100)}</span>
            </div>
          </div>

          <div className="space-y-3 border-t border-dashed border-ink/30 px-4 py-4">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payment method">
              {(['card', 'cash'] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={method === m}
                  onClick={() => setMethod(m)}
                  className={clsx('rounded-ctl border py-2 text-sm font-medium capitalize', method === m ? 'border-currant-600 bg-currant-50 text-currant-700' : 'border-line hover:bg-paper')}
                >
                  {m}
                </button>
              ))}
            </div>
            {method === 'cash' && (
              <div>
                <Input inputMode="decimal" placeholder={`Cash received (${money(total / 100)})`} value={tendered} onChange={(e) => setTendered(e.target.value.replace(/[^0-9.]/g, ''))} />
                <div className="mt-2 flex flex-wrap gap-2">
                  {quick.map((v) => (
                    <button key={v} onClick={() => setTendered((v / 100).toFixed(2))} className="rounded-full border border-line px-3 py-1 text-xs hover:bg-paper">
                      {v === total ? 'Exact' : money(v / 100)}
                    </button>
                  ))}
                </div>
                <p className={clsx('mt-2 text-sm', short ? 'text-brick-600' : 'text-ink-soft')}>
                  {short ? `Short by ${money((total - tenderedCents) / 100)}` : `Change due ${money((tenderedCents - total) / 100)}`}
                </p>
              </div>
            )}
            <Button
              size="lg"
              className="w-full"
              disabled={lines.length === 0 || short || overStock || checkout.isPending}
              onClick={() => checkout.mutate()}
            >
              {checkout.isPending ? 'Processing...' : `Charge ${money(total / 100)}`}
            </Button>
          </div>
        </div>
        <div className="ticket-edge" aria-hidden />
      </aside>

      <Modal open={!!sale} onClose={() => setSale(null)} title="Sale complete">
        {sale && <Receipt sale={sale} />}
      </Modal>
    </div>
  )
}
