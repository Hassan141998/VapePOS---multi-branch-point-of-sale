import { useQuery } from '@tanstack/react-query'
import { Eye, Search } from 'lucide-react'
import { useState } from 'react'
import { Receipt } from '../components/Receipt'
import { Button, Card, Empty, Field, Input, Modal, PageHeader, Pill, Spinner, TableWrap, td, th } from '../components/ui'
import { useBranches } from '../hooks/queries'
import { api, errorMessage } from '../lib/api'
import { dateTime, money, todayISO } from '../lib/format'
import type { Sale, SaleSummary } from '../lib/types'
import { useActiveBranch } from '../store/branch'

const shift = (isoDate: string, days: number) => {
  const d = new Date(isoDate + 'T00:00:00'); d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ReceiptModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sales', 'one', id],
    enabled: id != null,
    queryFn: async () => (await api.get<Sale>(`/sales/${id}`)).data,
  })
  return (
    <Modal open={id != null} onClose={onClose} title="Receipt">
      {isLoading ? <Spinner /> : error || !data ? <p className="text-sm text-brick-600">{errorMessage(error)}</p> : <Receipt sale={data} />}
    </Modal>
  )
}

export default function Sales() {
  const { branchId } = useActiveBranch()
  const { data: branches = [] } = useBranches()
  const today = todayISO()
  const [from, setFrom] = useState(shift(today, -6))
  const [to, setTo] = useState(today)
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)

  const valid = !!from && !!to && from <= to
  const { data = [], isLoading } = useQuery({
    queryKey: ['sales', 'list', branchId, from, to, search],
    enabled: valid,
    queryFn: async () =>
      (await api.get<SaleSummary[]>('/sales', { params: { branch_id: branchId ?? undefined, date_from: from, date_to: to, search: search.trim() || undefined, limit: 200 } })).data,
  })
  const branchName = (id: number) => branches.find((b) => b.id === id)?.name ?? `#${id}`
  const total = data.reduce((s, r) => s + r.total_amount, 0)

  return (
    <>
      <PageHeader title="Sales" subtitle="Every receipt. Open one to view or reprint it." />
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <Field label="From"><Input type="date" max={to || undefined} value={from} onChange={(e) => setFrom(e.target.value)} className="!w-40" /></Field>
          <Field label="To"><Input type="date" min={from || undefined} value={to} onChange={(e) => setTo(e.target.value)} className="!w-40" /></Field>
          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <Input className="pl-9" placeholder="Search receipt number" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search receipt number" />
          </div>
          <span className="ml-auto text-sm text-ink-muted">{valid ? `${data.length} receipt${data.length === 1 ? '' : 's'} \u00B7 ${money(total)}` : ''}</span>
        </div>
        {!valid ? <p role="alert" className="p-4 text-sm text-brick-600">Pick a start date that is on or before the end date.</p> : isLoading ? <Spinner /> : data.length === 0 ? (
          <Empty title="No sales found">Nothing was sold in this period. Try a wider date range.</Empty>
        ) : (
          <TableWrap>
            <thead><tr className="border-b border-line bg-paper/60">
              <th className={th}>Receipt</th><th className={th}>Date</th>{branchId == null && <th className={th}>Branch</th>}
              <th className={th}>Cashier</th><th className={th}>Payment</th><th className={th}>Total</th><th className={th} />
            </tr></thead>
            <tbody className="divide-y divide-line">
              {data.map((s) => (
                <tr key={s.id}>
                  <td className={`${td} font-medium`}>{s.receipt_number}</td>
                  <td className={td}>{dateTime(s.created_at)}</td>
                  {branchId == null && <td className={td}>{branchName(s.branch_id)}</td>}
                  <td className={td}>{s.cashier_name ?? '-'}</td>
                  <td className={td}><Pill tone={s.payment_method === 'cash' ? 'green' : 'purple'}>{s.payment_method}</Pill></td>
                  <td className={td}>{money(s.total_amount)}</td>
                  <td className={td}><Button size="sm" variant="secondary" onClick={() => setOpenId(s.id)}><Eye size={14} /> View</Button></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
        {data.length === 200 && <p className="border-t border-line p-3 text-center text-xs text-ink-muted">Showing the latest 200 receipts. Narrow the dates to see older ones.</p>}
      </Card>
      <ReceiptModal id={openId} onClose={() => setOpenId(null)} />
    </>
  )
}
