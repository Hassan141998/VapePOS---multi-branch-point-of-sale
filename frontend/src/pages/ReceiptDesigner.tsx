import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Image as ImageIcon, Printer, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { ReceiptPaper } from '../components/Receipt'
import { RangeField, Tabs, Toggle } from '../components/controls'
import { Button, Card, ErrorNote, Field, PageHeader, Select, Spinner, Textarea } from '../components/ui'
import { useBranches, useSettings } from '../hooks/queries'
import { api, errorMessage } from '../lib/api'
import { priceCart, toCents } from '../lib/pricing'
import { DEFAULT_RECEIPT } from '../lib/settings'
import type { Branch, ReceiptDesign, ReceiptFont, Sale } from '../lib/types'
import { toast } from '../store/toast'

type Tab = 'general' | 'header' | 'content' | 'footer'
const FONTS: ReceiptFont[] = ['Arial', 'Courier New', 'Georgia', 'Tahoma', 'Times New Roman', 'Verdana']
const MAX_LOGO_BYTES = 150 * 1024

const SAMPLE_BRANCH: Branch = {
  id: 0, name: 'My Store', code: 'MS', address: '123 Main St, City, Country', phone: '+1 (555) 123-4567', tax_number: 'TAX-0001234',
  tax_rate: 10, receipt_header_text: null, receipt_footer_text: null, is_active: true,
}

/** A made-up sale, priced with the same maths as the till, so the preview shows every kind of line. */
function sampleSale(branch: Branch): Sale {
  const items = [
    { product_id: 1, product_name: 'Mango Ice 20mg', barcode: '5901234123457', quantity: 2, unit_price: 10.99 },
    { product_id: 2, product_name: 'Pod Kit - Matte Black', barcode: '5012345678900', quantity: 1, unit_price: 24.99 },
    { product_id: 3, product_name: 'Coil 0.6 ohm (5 pack)', barcode: '4006381333931', quantity: 1, unit_price: 5.99 },
  ]
  const priced = priceCart(
    items.map((i) => ({ productId: i.product_id, category: null, unitCents: toCents(i.unit_price), qty: i.quantity })),
    branch.tax_rate,
    { type: 'percent', value: 10, applies_to: 'all', category: null, product_id: null, min_purchase: 0, name: 'Welcome offer' },
  )
  return {
    id: 0, receipt_number: `${branch.code}-260921-A1B2C3`, branch, cashier_name: 'Sample Cashier',
    subtotal: priced.net / 100, tax_rate: branch.tax_rate, tax_amount: priced.tax / 100, total_amount: priced.total / 100,
    payment_method: 'cash', amount_tendered: 60, change_due: 60 - priced.total / 100,
    discount_amount: priced.discount / 100, discount_code: 'WELCOME10', discount_name: 'Welcome offer',
    created_at: new Date().toISOString(),
    items: items.map((i, n) => ({ ...i, discount_amount: priced.lineDiscounts[n] / 100, line_total: (i.unit_price * 100 * i.quantity) / 100 })),
  }
}

export default function ReceiptDesigner() {
  const qc = useQueryClient()
  const { receipt, business, isLoading } = useSettings()
  const { data: branches = [] } = useBranches()
  const [draft, setDraft] = useState<ReceiptDesign | null>(null)
  const [tab, setTab] = useState<Tab>('general')
  const [previewOnly, setPreviewOnly] = useState(false)
  const [branchId, setBranchId] = useState('')
  const [logoError, setLogoError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const d = draft ?? receipt
  const dirty = draft !== null
  const set = <K extends keyof ReceiptDesign>(k: K, v: ReceiptDesign[K]) => setDraft({ ...d, [k]: v })
  const branch = branches.find((b) => String(b.id) === branchId) ?? SAMPLE_BRANCH
  const sale = useMemo(() => sampleSale(branch), [branch])

  const save = useMutation({
    mutationFn: async () => (await api.put<ReceiptDesign>('/settings/receipt', d)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['settings'] }); setDraft(null); toast.success('Receipt design saved') },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const onLogo = (file: File | undefined) => {
    setLogoError('')
    if (!file) return
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return setLogoError('Use a PNG, JPEG, WebP or SVG image.')
    if (file.size > MAX_LOGO_BYTES) return setLogoError('The logo is too big. Use an image under 150 KB.')
    const reader = new FileReader()
    reader.onload = () => setDraft({ ...d, logo_data_url: String(reader.result), show_logo: true })
    reader.onerror = () => setLogoError('Could not read that file.')
    reader.readAsDataURL(file)
  }

  if (isLoading) return <Spinner />

  const paper = <ReceiptPaper sale={sale} design={d} business={business} />

  if (previewOnly) {
    return (
      <>
        <PageHeader title="Receipt Designer" subtitle="Preview mode" actions={
          <>
            <Button variant="secondary" onClick={() => window.print()}><Printer size={15} /> Print</Button>
            <Button variant="secondary" onClick={() => setPreviewOnly(false)}><EyeOff size={15} /> Exit preview</Button>
          </>
        } />
        <Card className="p-6">{paper}</Card>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Receipt Designer"
        subtitle="Customize your receipt design and settings."
        actions={
          <>
            <Button variant="secondary" onClick={() => setDraft({ ...DEFAULT_RECEIPT })}><RotateCcw size={15} /> Reset</Button>
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}><Save size={15} /> {save.isPending ? 'Saving...' : 'Save Changes'}</Button>
          </>
        }
      />
      {dirty && <p className="mb-3 text-sm text-amber-700">You have unsaved changes. The preview shows them, but your till still prints the saved design.</p>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="space-y-4 p-5">
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            { id: 'general', label: 'General' }, { id: 'header', label: 'Header' }, { id: 'content', label: 'Content' }, { id: 'footer', label: 'Footer' },
          ]} />

          {tab === 'general' && (
            <div className="space-y-4">
              <RangeField label="Receipt width" value={d.width_px} min={200} max={420} step={10} unit="px" onChange={(v) => set('width_px', v)} />
              <p className="-mt-2 text-xs text-ink-muted">About 300 px fits an 80 mm thermal roll; 220 px suits 58 mm.</p>
              <RangeField label="Font size" value={d.font_size} min={8} max={18} unit="px" onChange={(v) => set('font_size', v)} />
              <Field label="Font family">
                <Select value={d.font_family} onChange={(e) => set('font_family', e.target.value as ReceiptFont)}>{FONTS.map((f) => <option key={f}>{f}</option>)}</Select>
              </Field>
              <Toggle label="Print automatically after sale" hint="Opens the print dialog as soon as a sale is complete." checked={d.print_after_sale} onChange={(v) => set('print_after_sale', v)} />
              <p className="rounded-ctl bg-paper px-3 py-2 text-xs text-ink-muted">Currency is set in System Settings, and each branch has its own tax rate, tax number, address and phone (Branches page).</p>
            </div>
          )}

          {tab === 'header' && (
            <div className="space-y-3">
              <div className="rounded-ctl border border-line p-3">
                <Toggle label="Show logo" checked={d.show_logo} onChange={(v) => set('show_logo', v)} />
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" aria-label="Upload logo" onChange={(e) => { onLogo(e.target.files?.[0]); e.target.value = '' }} />
                <div className="mt-2 flex items-center gap-3">
                  {d.logo_data_url ? <img src={d.logo_data_url} alt="Your logo" className="h-12 max-w-[120px] rounded border border-line bg-white object-contain p-1" /> : <span className="text-sm text-ink-muted">No logo yet</span>}
                  <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}><ImageIcon size={14} /> {d.logo_data_url ? 'Replace' : 'Upload logo'}</Button>
                  {d.logo_data_url && <Button size="sm" variant="ghost" onClick={() => setDraft({ ...d, logo_data_url: null, show_logo: false })}><Trash2 size={14} /> Remove</Button>}
                </div>
                {logoError && <div className="mt-2"><ErrorNote>{logoError}</ErrorNote></div>}
              </div>
              <Toggle label="Show business name" hint="From System Settings." checked={d.show_business_name} onChange={(v) => set('show_business_name', v)} />
              <Toggle label="Show address" hint="The branch address." checked={d.show_address} onChange={(v) => set('show_address', v)} />
              <Toggle label="Show phone" hint="The branch phone." checked={d.show_phone} onChange={(v) => set('show_phone', v)} />
              <Toggle label="Show email" hint="From System Settings." checked={d.show_email} onChange={(v) => set('show_email', v)} />
              <Toggle label="Show website" hint="From System Settings." checked={d.show_website} onChange={(v) => set('show_website', v)} />
              <Toggle label="Show tax number" checked={d.show_tax_number} onChange={(v) => set('show_tax_number', v)} />
              <Field label="Extra header text" hint="Shown under the branch name. A branch's own header text (Branches page) is always shown first.">
                <Textarea maxLength={300} value={d.header_extra} onChange={(e) => set('header_extra', e.target.value)} placeholder="Open daily 9am to 9pm" />
              </Field>
            </div>
          )}

          {tab === 'content' && (
            <div className="space-y-1">
              <Toggle label="Receipt number" checked={d.show_receipt_number} onChange={(v) => set('show_receipt_number', v)} />
              <Toggle label="Date and time" checked={d.show_datetime} onChange={(v) => set('show_datetime', v)} />
              <Toggle label="Cashier name" checked={d.show_cashier} onChange={(v) => set('show_cashier', v)} />
              <Toggle label="Item barcodes" hint="Print each product's barcode under its name." checked={d.show_item_barcode} onChange={(v) => set('show_item_barcode', v)} />
              <Toggle label="Quantity x price on each line" hint="Off shows only the quantity." checked={d.show_unit_price} onChange={(v) => set('show_unit_price', v)} />
              <Toggle label="Tax line" checked={d.show_tax_line} onChange={(v) => set('show_tax_line', v)} />
              <Toggle label="Payment details" hint="How it was paid, amount received and change." checked={d.show_payment} onChange={(v) => set('show_payment', v)} />
            </div>
          )}

          {tab === 'footer' && (
            <div className="space-y-3">
              <Toggle label="Show branch footer text" hint="The footer set on each branch (Branches page)." checked={d.show_branch_footer} onChange={(v) => set('show_branch_footer', v)} />
              <Field label="Thank-you message"><Textarea maxLength={300} value={d.footer_text} onChange={(e) => set('footer_text', e.target.value)} placeholder="Thank you for your purchase!" /></Field>
              <Field label="Return policy"><Textarea maxLength={500} value={d.return_policy} onChange={(e) => set('return_policy', e.target.value)} placeholder="Unopened items can be returned within 14 days with this receipt." /></Field>
              <Toggle label="Receipt barcode" hint="Lets you scan the receipt number for returns." checked={d.show_receipt_barcode} onChange={(v) => set('show_receipt_barcode', v)} />
            </div>
          )}
        </Card>

        <Card className="p-5 lg:sticky lg:top-20 lg:self-start">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Receipt preview</h2>
              <p className="text-sm text-ink-muted">A sample sale with a discount.</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPreviewOnly(true)}><Eye size={14} /> Preview Mode</Button>
              <Button size="sm" variant="secondary" onClick={() => window.print()}><Printer size={14} /> Print</Button>
            </div>
          </div>
          {branches.length > 0 && (
            <Field label="Preview with branch" className="mb-3">
              <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">Sample store</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          )}
          <div className="overflow-x-auto rounded-ctl bg-paper/60 p-4" data-testid="receipt-preview">{paper}</div>
        </Card>
      </div>
    </>
  )
}
