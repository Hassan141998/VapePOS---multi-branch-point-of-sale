import { Printer, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BarcodeSvg } from '../components/BarcodeSvg'
import { NumberInput, Toggle } from '../components/controls'
import { Button, Card, Empty, Field, Input, PageHeader, Pill, Select, Spinner, TableWrap, td, th } from '../components/ui'
import { useAllProducts } from '../hooks/queries'
import { barcodeSvg, BARCODE_TYPES, DEFAULT_STYLE, type BarcodeStyle } from '../lib/barcode'
import { money } from '../lib/format'
import { printHtml } from '../lib/files'
import { LABEL_SIZES, labelSheetHtml, type Label, type LabelLayout } from '../lib/labels'
import { toast } from '../store/toast'

const LABEL_STYLE: Omit<BarcodeStyle, 'format'> = { ...DEFAULT_STYLE, width: 2, height: 60, fontSize: 14, margin: 4 }

export default function BarcodeGenerator() {
  const { data: products = [], isLoading } = useAllProducts()
  const [search, setSearch] = useState('')
  const [format, setFormat] = useState('CODE128')
  const [sizeId, setSizeId] = useState('medium')
  const [layout, setLayout] = useState<LabelLayout>('label-printer')
  const [perProduct, setPerProduct] = useState(1)
  const [showName, setShowName] = useState(true)
  const [showPrice, setShowPrice] = useState(true)
  const [selected, setSelected] = useState<Record<number, number>>({}) // product id -> labels

  const style: BarcodeStyle = useMemo(() => ({ ...LABEL_STYLE, format }), [format])
  const size = LABEL_SIZES.find((s) => s.id === sizeId)!
  const q = search.trim().toLowerCase()
  const visible = products.filter((p) => !q || [p.name, p.barcode, p.brand, p.flavor].some((v) => v?.toLowerCase().includes(q)))
  const valid = useMemo(() => new Map(products.map((p) => [p.id, barcodeSvg(p.barcode, style).ok])), [products, style])

  const chosen = products.filter((p) => selected[p.id] != null)
  const printable = chosen.filter((p) => valid.get(p.id))
  const skipped = chosen.length - printable.length
  const totalLabels = printable.reduce((s, p) => s + selected[p.id], 0)

  const toggle = (id: number, on: boolean) => {
    const next = { ...selected }
    if (on) next[id] = perProduct
    else delete next[id]
    setSelected(next)
  }
  const selectAll = () => { const next = { ...selected }; for (const p of visible) next[p.id] = next[p.id] ?? perProduct; setSelected(next) }
  const applyDefaultQty = (n: number) => {
    setPerProduct(n)
    setSelected(Object.fromEntries(Object.keys(selected).map((id) => [id, n])))
  }

  const print = () => {
    const labels: Label[] = []
    for (const p of printable) {
      const r = barcodeSvg(p.barcode, style)
      if (!r.ok) continue
      for (let i = 0; i < selected[p.id]; i++) labels.push({ svg: r.svg, name: showName ? p.name : undefined, price: showPrice ? money(p.selling_price) : undefined })
    }
    if (labels.length === 0) return toast.error('Select at least one product first.')
    if (labels.length > 2000) return toast.error('That is too many labels at once. Print 2000 or fewer.')
    printHtml(labelSheetHtml(labels, size, layout))
  }

  const preview = printable[0]

  return (
    <>
      <PageHeader title="Barcode Generator" subtitle="Print barcode labels for your products." />
      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card className="space-y-4 p-5">
            <div>
              <h2 className="text-base font-semibold">Barcode settings</h2>
              <p className="text-sm text-ink-muted">Configure your barcode design and print settings.</p>
            </div>
            <Field label="Label template">
              <Select value={sizeId} onChange={(e) => setSizeId(e.target.value)}>{LABEL_SIZES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
            </Field>
            <Field label="Print layout">
              <Select value={layout} onChange={(e) => setLayout(e.target.value as LabelLayout)}>
                <option value="label-printer">Label printer (one label per page)</option>
                <option value="a4">A4 sheet (many labels per page)</option>
              </Select>
            </Field>
            <Field label="Barcode type" hint={BARCODE_TYPES.find((t) => t.value === format)?.hint}>
              <Select value={format} onChange={(e) => setFormat(e.target.value)}>{BARCODE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
            </Field>
            <Field label="Quantity (per product)">
              <NumberInput min={1} max={100} value={perProduct} onValue={applyDefaultQty} />
            </Field>
            <div>
              <Toggle label="Show product name" checked={showName} onChange={setShowName} />
              <Toggle label="Show price" checked={showPrice} onChange={setShowPrice} />
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 text-sm font-semibold">Label preview</h3>
            <div className="flex min-h-[110px] items-center justify-center rounded-ctl border border-dashed border-line bg-paper/50 p-3">
              {preview ? (
                <div className="w-full text-center" style={{ maxWidth: size.w * 3.2 }}>
                  {showName && <div className="truncate text-xs font-semibold">{preview.name}</div>}
                  <BarcodeSvg value={preview.barcode} style={style} className="[&_svg]:h-auto [&_svg]:w-full" />
                  {showPrice && <div className="text-sm font-bold">{money(preview.selling_price)}</div>}
                </div>
              ) : <p className="text-center text-sm text-ink-muted">Select a product to preview its label.</p>}
            </div>
          </Card>
        </div>

        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
            <div>
              <h2 className="text-base font-semibold">Select products</h2>
              <p className="text-sm text-ink-muted">Choose products to generate barcodes for.</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-ink-muted">{chosen.length} of {products.length} products selected</span>
              <Button size="sm" variant="secondary" onClick={selectAll}>Select all</Button>
              <Button size="sm" variant="secondary" onClick={() => setSelected({})}>Deselect all</Button>
            </div>
          </div>
          <div className="border-b border-line p-4">
            <div className="relative max-w-sm">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
              <Input className="pl-9" placeholder="Search products" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
            </div>
          </div>
          {isLoading ? <Spinner /> : visible.length === 0 ? <Empty title="No products found">Add products first, or change your search.</Empty> : (
            <TableWrap>
              <thead><tr className="border-b border-line bg-paper/60">
                <th className={th}>Select</th><th className={th}>Product</th><th className={th}>Barcode</th><th className={th}>Price</th><th className={th}>Labels</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {visible.map((p) => {
                  const on = selected[p.id] != null
                  return (
                    <tr key={p.id}>
                      <td className={td}>
                        <input type="checkbox" className="h-4 w-4 accent-[#46307E]" checked={on} onChange={(e) => toggle(p.id, e.target.checked)} aria-label={`Select ${p.name}`} />
                      </td>
                      <td className={`${td} font-medium`}>{p.name}</td>
                      <td className={td}>
                        <span className="text-ink-muted">{p.barcode}</span>
                        {!valid.get(p.id) && <div><Pill tone="amber">Not valid for this type</Pill></div>}
                      </td>
                      <td className={td}>{money(p.selling_price)}</td>
                      <td className={td}>
                        <NumberInput
                          min={1} max={100} className="!w-20" disabled={!on} aria-label={`Labels for ${p.name}`}
                          value={on ? selected[p.id] : perProduct} onValue={(n) => setSelected({ ...selected, [p.id]: n })}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </TableWrap>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-4">
            <p className="text-sm text-ink-muted">
              {totalLabels} label{totalLabels === 1 ? '' : 's'} ready{skipped > 0 && <> &middot; <span className="text-amber-700">{skipped} product{skipped === 1 ? '' : 's'} skipped (barcode not valid for {format})</span></>}
            </p>
            <Button onClick={print} disabled={totalLabels === 0}><Printer size={16} /> Print labels</Button>
          </div>
        </Card>
      </div>
    </>
  )
}
