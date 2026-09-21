import { Printer } from 'lucide-react'
import { useMemo } from 'react'
import { barcodeSvg, DEFAULT_STYLE } from '../lib/barcode'
import { dateTime, money } from '../lib/format'
import type { BusinessSettings, ReceiptDesign, Sale } from '../lib/types'
import { useSettings } from '../hooks/queries'
import { Button } from './ui'

const rule = <div className="my-2.5 border-t border-dashed border-ink/40" />

/** The paper itself. Used for real receipts and for the live preview in the Receipt Designer. */
export function ReceiptPaper({ sale, design, business }: { sale: Sale; design: ReceiptDesign; business: BusinessSettings }) {
  const b = sale.branch
  const discount = sale.discount_amount ?? 0
  const itemsTotal = sale.subtotal + discount
  const bars = useMemo(
    () => (design.show_receipt_barcode ? barcodeSvg(sale.receipt_number, { ...DEFAULT_STYLE, width: 1, height: 36, displayValue: false, margin: 0 }) : null),
    [design.show_receipt_barcode, sale.receipt_number],
  )
  const line = (label: string, value: string, extra = '') => (
    <div className={`flex justify-between gap-3 ${extra}`}><span>{label}</span><span className="text-right">{value}</span></div>
  )

  return (
    <div
      className="print-area mx-auto rounded-panel border border-dashed border-line bg-white p-4 leading-snug"
      style={{ width: design.width_px, maxWidth: '100%', fontFamily: `"${design.font_family}", system-ui, sans-serif`, fontSize: design.font_size }}
    >
      {/* ---- header ---- */}
      <div className="text-center">
        {design.show_logo && design.logo_data_url && <img src={design.logo_data_url} alt="" className="mx-auto mb-2 max-h-16 max-w-full object-contain" />}
        {design.show_business_name && business.business_name && <div className="font-semibold">{business.business_name}</div>}
        <div className="whitespace-pre-line font-semibold">{b.receipt_header_text || b.name}</div>
        {design.header_extra && <div className="whitespace-pre-line">{design.header_extra}</div>}
        {design.show_address && b.address && <div className="whitespace-pre-line">{b.address}</div>}
        {design.show_phone && b.phone && <div>Tel {b.phone}</div>}
        {design.show_email && business.email && <div>{business.email}</div>}
        {design.show_website && business.website && <div>{business.website}</div>}
        {design.show_tax_number && b.tax_number && <div className="text-ink-muted">Tax no. {b.tax_number}</div>}
      </div>
      {rule}

      {/* ---- meta ---- */}
      {design.show_receipt_number && line('Receipt', sale.receipt_number)}
      {design.show_datetime && line('Date', dateTime(sale.created_at))}
      {design.show_cashier && sale.cashier_name && line('Cashier', sale.cashier_name)}
      {(design.show_receipt_number || design.show_datetime || (design.show_cashier && sale.cashier_name)) && rule}

      {/* ---- items ---- */}
      {sale.items.map((i) => (
        <div key={i.product_id} className="mb-1">
          <div>{i.product_name}</div>
          {design.show_item_barcode && i.barcode && <div className="text-ink-muted" style={{ fontSize: '0.85em' }}>{i.barcode}</div>}
          <div className="flex justify-between text-ink-soft">
            <span>{design.show_unit_price ? `${i.quantity} x ${money(i.unit_price)}` : `Qty ${i.quantity}`}</span>
            <span>{money(i.line_total)}</span>
          </div>
        </div>
      ))}
      {rule}

      {/* ---- totals ---- */}
      {line('Subtotal', money(itemsTotal))}
      {discount > 0 && line(`Discount${sale.discount_code ? ` (${sale.discount_code})` : ''}`, `-${money(discount)}`)}
      {design.show_tax_line && line(`Tax (${sale.tax_rate}%)`, money(sale.tax_amount))}
      <div className="flex justify-between gap-3 font-display font-semibold" style={{ fontSize: '1.2em' }}>
        <span>Total</span><span>{money(sale.total_amount)}</span>
      </div>
      {design.show_payment && (
        <div className="mt-1">
          {line(`Paid by ${sale.payment_method}`, money(sale.amount_tendered))}
          {sale.payment_method === 'cash' && line('Change', money(sale.change_due))}
        </div>
      )}

      {/* ---- footer ---- */}
      {((design.show_branch_footer && b.receipt_footer_text) || design.footer_text || design.return_policy || bars) && rule}
      <div className="text-center">
        {design.show_branch_footer && b.receipt_footer_text && <div className="whitespace-pre-line text-ink-muted">{b.receipt_footer_text}</div>}
        {design.footer_text && <div className="mt-1 whitespace-pre-line font-medium">{design.footer_text}</div>}
        {design.return_policy && <div className="mt-1 whitespace-pre-line text-ink-muted" style={{ fontSize: '0.85em' }}>{design.return_policy}</div>}
        {bars?.ok && <div className="mx-auto mt-2 w-40 max-w-full" dangerouslySetInnerHTML={{ __html: bars.svg }} />}
      </div>
    </div>
  )
}

/** Receipt with the shop's saved design, plus a Print button. */
export function Receipt({ sale }: { sale: Sale }) {
  const { receipt, business } = useSettings()
  return (
    <div>
      <ReceiptPaper sale={sale} design={receipt} business={business} />
      <div className="no-print mt-4 flex justify-center">
        <Button variant="secondary" onClick={() => window.print()}><Printer size={16} /> Print receipt</Button>
      </div>
    </div>
  )
}
