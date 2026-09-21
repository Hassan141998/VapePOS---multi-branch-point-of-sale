import { Printer } from 'lucide-react'
import { dateTime, money } from '../lib/format'
import type { Sale } from '../lib/types'
import { Button } from './ui'

/** Printable receipt. Header/footer text come from the branch profile. */
export function Receipt({ sale }: { sale: Sale }) {
  const b = sale.branch
  return (
    <div>
      <div className="print-area mx-auto max-w-[320px] rounded-panel border border-dashed border-line bg-white p-4 font-body text-[13px] leading-5">
        <div className="whitespace-pre-line text-center font-semibold">{b.receipt_header_text || b.name}</div>
        {b.tax_number && <div className="text-center text-ink-muted">Tax no. {b.tax_number}</div>}
        <div className="my-3 border-t border-dashed border-ink/40" />
        <div className="flex justify-between"><span>Receipt</span><span>{sale.receipt_number}</span></div>
        <div className="flex justify-between"><span>Date</span><span>{dateTime(sale.created_at)}</span></div>
        {sale.cashier_name && <div className="flex justify-between"><span>Cashier</span><span>{sale.cashier_name}</span></div>}
        <div className="my-3 border-t border-dashed border-ink/40" />
        {sale.items.map((i) => (
          <div key={i.product_id} className="mb-1">
            <div>{i.product_name}</div>
            <div className="flex justify-between text-ink-soft"><span>{i.quantity} x {money(i.unit_price)}</span><span>{money(i.line_total)}</span></div>
          </div>
        ))}
        <div className="my-3 border-t border-dashed border-ink/40" />
        <div className="flex justify-between"><span>Subtotal</span><span>{money(sale.subtotal)}</span></div>
        <div className="flex justify-between"><span>Tax ({sale.tax_rate}%)</span><span>{money(sale.tax_amount)}</span></div>
        <div className="flex justify-between font-display text-base font-semibold"><span>Total</span><span>{money(sale.total_amount)}</span></div>
        <div className="mt-1 flex justify-between"><span>Paid by {sale.payment_method}</span><span>{money(sale.amount_tendered)}</span></div>
        {sale.payment_method === 'cash' && <div className="flex justify-between"><span>Change</span><span>{money(sale.change_due)}</span></div>}
        {b.receipt_footer_text && <><div className="my-3 border-t border-dashed border-ink/40" /><div className="whitespace-pre-line text-center text-ink-muted">{b.receipt_footer_text}</div></>}
      </div>
      <div className="no-print mt-4 flex justify-center">
        <Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> Print receipt</Button>
      </div>
    </div>
  )
}
