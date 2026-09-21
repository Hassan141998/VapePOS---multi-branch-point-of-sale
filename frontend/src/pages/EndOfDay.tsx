import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Printer } from 'lucide-react'
import { useState } from 'react'
import { Button, Card, Empty, ErrorNote, Field, Input, PageHeader, Pill, Spinner, TableWrap, Textarea, td, th } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { dateTime, money, shortDay } from '../lib/format'
import type { ZReport, ZReportView } from '../lib/types'
import { useActiveBranch } from '../store/branch'
import { toast } from '../store/toast'

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={clsx('flex justify-between py-1.5 text-sm', strong && 'font-display text-lg font-semibold')}>
      <span className={strong ? '' : 'text-ink-soft'}>{label}</span><span>{value}</span>
    </div>
  )
}

export default function EndOfDay() {
  const { branchId } = useActiveBranch()
  const qc = useQueryClient()
  // "Today" is decided by the SERVER (business timezone), never by this browser's clock.
  const [picked, setPicked] = useState<string | null>(null)
  const [openingFloat, setOpeningFloat] = useState('0')
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const todayQuery = useQuery({
    queryKey: ['zreport', 'today', branchId],
    enabled: branchId != null,
    queryFn: async () => (await api.get<ZReportView>('/reports/z-report', { params: { branch_id: branchId } })).data,
  })
  const today = todayQuery.data?.totals.business_date
  const date = picked ?? today

  const view = useQuery({
    queryKey: ['zreport', 'view', branchId, date],
    enabled: branchId != null && !!date,
    queryFn: async () => (await api.get<ZReportView>('/reports/z-report', { params: { branch_id: branchId, business_date: date } })).data,
  })
  const history = useQuery({
    queryKey: ['zreport', 'history', branchId],
    enabled: branchId != null,
    queryFn: async () => (await api.get<ZReport[]>('/reports/z-reports', { params: { branch_id: branchId, limit: 14 } })).data,
  })

  const close = useMutation({
    mutationFn: async () =>
      (await api.post<ZReport>('/reports/z-report/close', {
        branch_id: branchId, business_date: date, opening_float: Number(openingFloat || 0),
        counted_cash: counted === '' ? undefined : Number(counted), notes: notes || undefined,
      })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['zreport'] }); toast.success('Day closed'); setError('') },
    onError: (e) => setError(errorMessage(e)),
  })

  if (branchId == null) {
    return <Card><Empty title="Choose a location">End-of-day reports are per branch. Pick one from the location menu at the top.</Empty></Card>
  }

  const t = view.data?.totals
  const z = view.data?.closure
  const expectedCash = (Number(openingFloat || 0)) + (t?.cash_total ?? 0)
  const liveVariance = counted === '' ? null : Number(counted) - expectedCash

  return (
    <>
      <PageHeader
        title="End of day"
        subtitle={t?.branch_name}
        actions={<>
          <Input type="date" className="!w-auto" max={today} value={date ?? ''} onChange={(e) => e.target.value && setPicked(e.target.value)} aria-label="Business date" />
          <Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> Print</Button>
        </>}
      />
      {view.isLoading || !t ? <Spinner /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="print-area p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Z-Report &middot; {shortDay(t.business_date)}</h2>
              {z ? <Pill tone="green">Closed</Pill> : <Pill tone="amber">Open day</Pill>}
            </div>
            <p className="text-sm text-ink-muted">{t.branch_name}</p>
            <div className="mt-3 divide-y divide-dashed divide-ink/25 border-y border-dashed border-ink/25">
              <div className="py-2">
                <Row label="Receipts" value={String(z?.receipts_count ?? t.receipts_count)} />
                <Row label="Items sold" value={String(z?.items_sold ?? t.items_sold)} />
              </div>
              <div className="py-2">
                <Row label="Subtotal" value={money(z?.subtotal ?? t.subtotal)} />
                <Row label="Tax collected" value={money(z?.tax_total ?? t.tax_total)} />
                <Row label="Total sales" value={money(z?.gross_total ?? t.gross_total)} strong />
              </div>
              <div className="py-2">
                <Row label="Cash payments" value={money(z?.cash_total ?? t.cash_total)} />
                <Row label="Card payments" value={money(z?.card_total ?? t.card_total)} />
              </div>
              {z && (
                <div className="py-2">
                  <Row label="Opening float" value={money(z.opening_float)} />
                  <Row label="Cash counted" value={money(z.counted_cash)} />
                  <Row label="Difference" value={z.cash_variance == null ? '-' : money(z.cash_variance)} strong />
                </div>
              )}
            </div>
            {z && <p className="mt-3 text-xs text-ink-muted">Closed by {z.closed_by_name ?? 'unknown'} on {dateTime(z.closed_at)}{z.notes ? ` \u00B7 ${z.notes}` : ''}</p>}
          </Card>

          <Card className="no-print p-5">
            {z ? (
              <Empty title="This day is closed">The totals are frozen. Pick another date to see a different day.</Empty>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); close.mutate() }} className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">Close the day</h2>
                  <p className="text-sm text-ink-muted">Count the drawer, enter what you find, and lock the totals.</p>
                </div>
                {error && <ErrorNote>{error}</ErrorNote>}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Opening float" hint="Cash you started the day with"><Input type="number" step="0.01" min="0" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} /></Field>
                  <Field label="Cash counted now" hint={`Expected ${money(expectedCash)}`}><Input type="number" step="0.01" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field>
                </div>
                {liveVariance !== null && (
                  <p className={clsx('rounded-ctl px-3 py-2 text-sm', Math.abs(liveVariance) < 0.005 ? 'bg-moss-100 text-moss-700' : 'bg-amber-100 text-amber-700')}>
                    {Math.abs(liveVariance) < 0.005 ? 'The drawer matches exactly.' : `${liveVariance > 0 ? 'Over' : 'Short'} by ${money(Math.abs(liveVariance))}`}
                  </p>
                )}
                <Field label="Notes (optional)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
                <Button type="submit" size="lg" className="w-full" disabled={close.isPending}
                  onClick={(e) => { if (!confirm('Close this day? The totals cannot be changed afterwards.')) e.preventDefault() }}>
                  Close day
                </Button>
              </form>
            )}
          </Card>
        </div>
      )}

      <Card className="no-print mt-5">
        <h2 className="px-5 py-4 text-base font-semibold">Recently closed days</h2>
        {history.data && history.data.length > 0 ? (
          <TableWrap>
            <thead><tr className="border-y border-line bg-paper/60"><th className={th}>Date</th><th className={th}>Receipts</th><th className={th}>Total</th><th className={th}>Cash</th><th className={th}>Card</th><th className={th}>Cash difference</th></tr></thead>
            <tbody className="divide-y divide-line">
              {history.data.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-paper" onClick={() => setPicked(r.business_date)}>
                  <td className={td}>{shortDay(r.business_date)}</td><td className={td}>{r.receipts_count}</td><td className={td}>{money(r.gross_total)}</td>
                  <td className={td}>{money(r.cash_total)}</td><td className={td}>{money(r.card_total)}</td>
                  <td className={td}>{r.cash_variance == null ? '-' : <Pill tone={Math.abs(r.cash_variance) < 0.005 ? 'green' : 'amber'}>{money(r.cash_variance)}</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : <Empty title="No closed days yet" />}
      </Card>
    </>
  )
}
