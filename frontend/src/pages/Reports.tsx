import { useQuery } from '@tanstack/react-query'
import { BarChart3, Download, Printer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button, Card, Empty, Field, Input, PageHeader, Select, Spinner } from '../components/ui'
import { useAllProducts, useBranches, useCategories } from '../hooks/queries'
import { api, errorMessage } from '../lib/api'
import { catLabel, currencyCode, money, moneyCompact, shortDay, todayISO } from '../lib/format'
import { downloadCsv, escapeHtml, printHtml } from '../lib/files'
import type { SalesReport } from '../lib/types'
import { useActiveBranch } from '../store/branch'

type Preset = 'today' | 'week' | 'month' | 'this-month' | 'custom'
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'week', label: 'Last 7 days' }, { id: 'month', label: 'Last 30 days' },
  { id: 'this-month', label: 'This month' }, { id: 'custom', label: 'Custom range' },
]

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shift = (isoDate: string, days: number) => { const d = new Date(isoDate + 'T00:00:00'); d.setDate(d.getDate() + days); return iso(d) }

export function rangeFor(preset: Preset, today: string, custom: { from: string; to: string }) {
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'week') return { from: shift(today, -6), to: today }
  if (preset === 'month') return { from: shift(today, -29), to: today }
  if (preset === 'this-month') return { from: today.slice(0, 8) + '01', to: today }
  return custom
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="px-5 py-4">
      <div className="text-sm text-ink-muted">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-xs text-ink-muted">{note}</div>
    </div>
  )
}

export default function Reports() {
  const { branchId } = useActiveBranch()
  const { data: branches = [] } = useBranches()
  const { data: products = [] } = useAllProducts()
  const { data: categories = [] } = useCategories()
  const today = todayISO()
  const [preset, setPreset] = useState<Preset>('week')
  const [custom, setCustom] = useState({ from: shift(today, -6), to: today })
  const [productId, setProductId] = useState('')
  const [category, setCategory] = useState('')

  const range = rangeFor(preset, today, custom)
  const validRange = !!range.from && !!range.to && range.from <= range.to
  const scope = branchId == null ? 'All locations' : (branches.find((b) => b.id === branchId)?.name ?? '')

  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', 'sales', branchId, range.from, range.to, productId, category],
    enabled: validRange,
    queryFn: async () =>
      (await api.get<SalesReport>('/reports/sales-summary', {
        params: { date_from: range.from, date_to: range.to, branch_id: branchId ?? undefined, product_id: productId || undefined, category: category || undefined },
      })).data,
  })

  const chart = useMemo(() => data?.daily.map((d) => ({ day: shortDay(d.date), revenue: d.revenue, transactions: d.transactions })) ?? [], [data])
  const productBars = useMemo(() => data?.top_products.slice(0, 8).map((p) => ({ name: p.name.length > 22 ? p.name.slice(0, 21) + '...' : p.name, quantity: p.quantity })) ?? [], [data])
  const empty = !!data && data.totals.transactions === 0

  const exportCsv = () => {
    if (!data) return
    downloadCsv([
      ['VapePOS sales report'], ['Location', scope], ['From', data.date_from], ['To', data.date_to], ['Currency', currencyCode()],
      ['Revenue is after discounts and before tax'], [],
      ['Revenue', 'Transactions', 'Average transaction', 'Items sold', 'Discounts given'],
      [data.totals.revenue, data.totals.transactions, data.totals.avg_transaction, data.totals.items_sold, data.totals.discounts], [],
      ['Date', 'Revenue', 'Transactions'], ...data.daily.map((d) => [d.date, d.revenue, d.transactions]), [],
      ['Top products', 'Category', 'Quantity', 'Revenue'], ...data.top_products.map((p) => [p.name, p.category ?? '', p.quantity, p.revenue]), [],
      ['Category', 'Quantity', 'Revenue'], ...data.by_category.map((c) => [c.category, c.quantity, c.revenue]),
    ], `sales-report-${data.date_from}-to-${data.date_to}.csv`)
  }

  const print = () => {
    if (!data) return
    const rows = (items: string[][]) => items.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Sales report</title><style>
      body{font-family:Arial,sans-serif;color:#111;margin:14mm} h1{font-size:18pt;margin:0} h2{font-size:12pt;margin:18px 0 6px} p{margin:2px 0;color:#444;font-size:10pt}
      table{width:100%;border-collapse:collapse;font-size:10pt} th,td{padding:4px 6px;border-bottom:1px solid #ddd;text-align:left} .n{text-align:right} th{background:#f3f3f3}
      .k{display:flex;gap:24px;margin-top:10px} .k div{font-size:9pt;color:#555} .k b{display:block;font-size:15pt;color:#111}
    </style></head><body>
      <h1>Sales report</h1><p>${escapeHtml(scope)} &middot; ${escapeHtml(data.date_from)} to ${escapeHtml(data.date_to)}</p>
      <div class="k"><div>Revenue<b>${escapeHtml(money(data.totals.revenue))}</b></div><div>Transactions<b>${data.totals.transactions}</b></div>
      <div>Avg. transaction<b>${escapeHtml(money(data.totals.avg_transaction))}</b></div><div>Items sold<b>${data.totals.items_sold}</b></div></div>
      <p>Revenue is after discounts and before tax.</p>
      <h2>Top products</h2><table><tr><th>Product</th><th class="n">Qty</th><th class="n">Revenue</th></tr>${rows(data.top_products.map((p) => [p.name, String(p.quantity), money(p.revenue)]))}</table>
      <h2>By category</h2><table><tr><th>Category</th><th class="n">Qty</th><th class="n">Revenue</th></tr>${rows(data.by_category.map((c) => [catLabel(c.category), String(c.quantity), money(c.revenue)]))}</table>
      <h2>Day by day</h2><table><tr><th>Date</th><th class="n">Transactions</th><th class="n">Revenue</th></tr>${rows(data.daily.map((d) => [d.date, String(d.transactions), money(d.revenue)]))}</table>
    </body></html>`)
  }

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={`Sales analytics and insights${scope ? ` - ${scope}` : ''}`}
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} disabled={!data}><Download size={15} /> Export CSV</Button>
            <Button variant="secondary" onClick={print} disabled={!data}><Printer size={15} /> Print</Button>
          </>
        }
      />
      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Date range">
            <Select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>{PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
          </Field>
          <Field label="Product">
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">All products</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.name}>{catLabel(c.name)}</option>)}
            </Select>
          </Field>
          {preset === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="From"><Input type="date" max={custom.to || undefined} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></Field>
              <Field label="To"><Input type="date" min={custom.from || undefined} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></Field>
            </div>
          )}
        </div>
        {!validRange && <p role="alert" className="mt-3 text-sm text-brick-600">Pick a start date that is on or before the end date.</p>}
      </Card>

      {!validRange ? null : isLoading ? <Spinner /> : error || !data ? (
        <Card><Empty title="Could not load the report">{errorMessage(error)}</Empty></Card>
      ) : (
        <div className="space-y-5">
          <Card className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
            <Kpi label="Revenue" value={money(data.totals.revenue)} note="After discounts, before tax" />
            <Kpi label="Transactions" value={String(data.totals.transactions)} note="For the selected period" />
            <Kpi label="Avg. transaction" value={money(data.totals.avg_transaction)} note="Per transaction" />
            <Kpi label="Items sold" value={String(data.totals.items_sold)} note={data.totals.discounts > 0 ? `${money(data.totals.discounts)} given in discounts` : 'Total items'} />
          </Card>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <h2 className="flex items-center gap-2 px-5 pt-4 text-base font-semibold"><BarChart3 size={16} /> Revenue over time</h2>
              {empty ? <Empty title="No data available">No sales found for the selected date range.</Empty> : (
                <div className="h-72 px-2 pb-3 pt-2" data-testid="revenue-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chart} margin={{ left: 4, right: 16, top: 8 }}>
                      <CartesianGrid stroke="#DCE2DF" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#66737E' }} tickLine={false} axisLine={false} minTickGap={16} />
                      <YAxis tick={{ fontSize: 12, fill: '#66737E' }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => moneyCompact(v)} />
                      <Tooltip formatter={(v) => money(Number(v))} />
                      <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#46307E" fill="#E3DBF1" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card>
              <h2 className="px-5 pt-4 text-base font-semibold">Top selling products</h2>
              {productBars.length === 0 ? <Empty title="No data available">No product sales found for the selected date range.</Empty> : (
                <div className="h-72 px-2 pb-3 pt-2" data-testid="products-chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={productBars} layout="vertical" margin={{ left: 8, right: 24 }}>
                      <CartesianGrid stroke="#DCE2DF" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#66737E' }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 12, fill: '#3A4753' }} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ fill: '#F2F4F3' }} />
                      <Bar dataKey="quantity" name="Sold" fill="#1E9E78" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <h2 className="px-5 py-4 text-base font-semibold">Best sellers</h2>
              {data.top_products.length === 0 ? <Empty title="Nothing sold in this period" /> : (
                <ol className="divide-y divide-line">
                  {data.top_products.map((p) => (
                    <li key={p.product_id} className="flex items-baseline justify-between gap-3 px-5 py-2.5 text-sm">
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="shrink-0 text-ink-muted">{p.quantity} sold &middot; {money(p.revenue)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
            <Card>
              <h2 className="px-5 py-4 text-base font-semibold">Sales by category</h2>
              {data.by_category.length === 0 ? <Empty title="Nothing sold in this period" /> : (
                <ol className="divide-y divide-line">
                  {data.by_category.map((c) => (
                    <li key={c.category} className="flex items-baseline justify-between gap-3 px-5 py-2.5 text-sm">
                      <span className="truncate font-medium">{catLabel(c.category)}</span>
                      <span className="shrink-0 text-ink-muted">{c.quantity} sold &middot; {money(c.revenue)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
