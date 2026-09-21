import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Card, Empty, PageHeader, Pill, Spinner, TableWrap, td, th } from '../components/ui'
import { useBranches } from '../hooks/queries'
import { api } from '../lib/api'
import { money, moneyCompact, shortDay } from '../lib/format'
import type { Dashboard as DashboardData, TopItem } from '../lib/types'
import { useActiveBranch } from '../store/branch'

export const BRANCH_COLORS = ['#46307E', '#1E9E78', '#D9822B', '#2D6CDF', '#B3468F', '#6B7280']

function Kpi({ label, value, note, to }: { label: string; value: string; note?: string; to?: string }) {
  const body = (
    <div className="px-5 py-4">
      <div className="text-sm text-ink-muted">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tracking-tight">{value}</div>
      {note && <div className="mt-0.5 text-xs text-ink-muted">{note}</div>}
    </div>
  )
  return to ? <Link to={to} className="block hover:bg-paper">{body}</Link> : body
}

function RankList({ items, empty }: { items: TopItem[]; empty: string }) {
  if (items.length === 0) return <Empty title={empty} />
  const max = Math.max(...items.map((i) => i.quantity))
  return (
    <ol className="divide-y divide-line">
      {items.map((it) => (
        <li key={it.label} className="px-5 py-2.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium">{it.label}</span>
            <span className="shrink-0 text-ink-muted">{it.quantity} sold &middot; {money(it.revenue)}</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-paper">
            <div className="h-full rounded-full bg-currant-500" style={{ width: `${(it.quantity / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  )
}

export default function Dashboard() {
  const { branchId } = useActiveBranch()
  const [days, setDays] = useState(14)
  const { data: branches = [] } = useBranches()
  const scopeName = branchId == null ? 'All locations' : branches.find((b) => b.id === branchId)?.name

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', branchId, days],
    queryFn: async () => (await api.get<DashboardData>('/reports/dashboard', { params: { branch_id: branchId ?? undefined, days } })).data,
  })

  const colorOf = (id: number) => BRANCH_COLORS[Math.max(0, branches.findIndex((b) => b.id === id)) % BRANCH_COLORS.length]

  const chartData = data?.daily.dates.map((d, i) => {
    const row: Record<string, string | number> = { date: shortDay(d) }
    data.daily.series.forEach((s) => { row[s.branch_name] = s.values[i] })
    return row
  })

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={scopeName}
        actions={
          <div className="flex rounded-ctl border border-line bg-white p-0.5" role="group" aria-label="Period">
            {[7, 14, 30].map((d) => (
              <button key={d} onClick={() => setDays(d)} className={clsx('rounded-[6px] px-3 py-1 text-sm', days === d ? 'bg-currant-600 text-white' : 'text-ink-soft hover:bg-paper')}>
                {d} days
              </button>
            ))}
          </div>
        }
      />
      {isLoading || !data ? <Spinner /> : (
        <div className="space-y-5">
          <Card className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
            <Kpi label="Sales today" value={money(data.kpis.today_sales)} note={`${data.kpis.today_receipts} receipts`} />
            <Kpi label={`Sales, last ${days} days`} value={money(data.kpis.period_sales)} note={`${data.kpis.period_receipts} receipts`} />
            <Kpi label="Gross profit" value={money(data.kpis.period_profit)} note="Selling price minus cost" />
            <Kpi label="Low-stock items" value={String(data.kpis.low_stock_count)} note="Open the list" to="/inventory?low=1" />
          </Card>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card>
              <h2 className="px-5 pt-4 text-base font-semibold">Sales per day</h2>
              <div className="h-72 px-2 pb-3 pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ left: 4, right: 16, top: 8 }}>
                    <CartesianGrid stroke="#DCE2DF" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#66737E' }} tickLine={false} axisLine={false} minTickGap={16} />
                    <YAxis tick={{ fontSize: 12, fill: '#66737E' }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => moneyCompact(v)} />
                    <Tooltip formatter={(v) => money(Number(v))} />
                    <Legend iconType="plainline" />
                    {data.daily.series.map((s) => (
                      <Line key={s.branch_id} type="monotone" dataKey={s.branch_name} stroke={colorOf(s.branch_id)} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <h2 className="px-5 pt-4 text-base font-semibold">Branch comparison</h2>
              <div className="h-72 px-2 pb-3 pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.by_branch} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid stroke="#DCE2DF" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 12, fill: '#66737E' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => moneyCompact(v)} />
                    <YAxis type="category" dataKey="branch_name" width={110} tick={{ fontSize: 12, fill: '#3A4753' }} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v) => money(Number(v))} cursor={{ fill: '#F2F4F3' }} />
                    <Bar dataKey="total" name="Sales" radius={[0, 4, 4, 0]}>
                      {data.by_branch.map((b) => <Cell key={b.branch_id} fill={colorOf(b.branch_id)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card><h2 className="px-5 py-4 text-base font-semibold">Top flavors</h2><RankList items={data.top_flavors} empty="No flavored items sold yet" /></Card>
            <Card><h2 className="px-5 py-4 text-base font-semibold">Top devices</h2><RankList items={data.top_devices} empty="No devices sold yet" /></Card>
          </div>

          <Card>
            <h2 className="px-5 py-4 text-base font-semibold">Running low</h2>
            {data.low_stock.length === 0 ? <Empty title="Every shelf is above its minimum" /> : (
              <TableWrap>
                <thead><tr className="border-y border-line bg-paper/60"><th className={th}>Product</th><th className={th}>Branch</th><th className={th}>In stock</th><th className={th}>Minimum</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {data.low_stock.map((r) => (
                    <tr key={`${r.product_id}-${r.branch_id}`}>
                      <td className={td}>{r.product_name}</td>
                      <td className={td}>{r.branch_name}</td>
                      <td className={td}><Pill tone={r.stock_quantity === 0 ? 'red' : 'amber'}>{r.stock_quantity}</Pill></td>
                      <td className={td}>{r.min_threshold}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </div>
      )}
    </>
  )
}
