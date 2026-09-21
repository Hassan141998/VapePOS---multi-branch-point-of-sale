import { Download, Printer, RotateCcw, Shuffle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BarcodeSvg } from '../components/BarcodeSvg'
import { ColorField, NumberInput, RangeField, Tabs, Toggle } from '../components/controls'
import { Button, Card, Field, Input, PageHeader, Select } from '../components/ui'
import { useAllProducts } from '../hooks/queries'
import { barcodeSvg, BARCODE_TYPES, DEFAULT_STYLE, randomValue, svgToPng, type BarcodeStyle } from '../lib/barcode'
import { downloadBlob, escapeHtml, printHtml } from '../lib/files'
import { toast } from '../store/toast'

type Mode = 'manual' | 'product'

export default function BarcodeDesigner() {
  const { data: products = [] } = useAllProducts()
  const [mode, setMode] = useState<Mode>('manual')
  const [manual, setManual] = useState('')
  const [productId, setProductId] = useState('')
  const [style, setStyle] = useState<BarcodeStyle>(DEFAULT_STYLE)
  const [copies, setCopies] = useState(1)

  const product = products.find((p) => String(p.id) === productId)
  const value = mode === 'manual' ? manual.trim() : (product?.barcode ?? '')
  const result = useMemo(() => barcodeSvg(value, style), [value, style])
  const set = <K extends keyof BarcodeStyle>(k: K, v: BarcodeStyle[K]) => setStyle({ ...style, [k]: v })
  const typeHint = BARCODE_TYPES.find((t) => t.value === style.format)?.hint

  const reset = () => { setStyle(DEFAULT_STYLE); setManual(''); setProductId(''); setCopies(1); setMode('manual') }

  const download = async () => {
    if (!result.ok) return
    try { downloadBlob(await svgToPng(result.svg), `barcode-${value}.png`) } catch { toast.error('Could not create the image. Try Print instead.') }
  }
  const print = () => {
    if (!result.ok) return
    const one = `<div class="c">${result.svg}${product ? `<div class="n">${escapeHtml(product.name)}</div>` : ''}</div>`
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Barcode</title><style>
      @page { margin: 10mm } body { margin: 0; font-family: Arial, sans-serif; display: flex; flex-wrap: wrap; gap: 6mm }
      .c { text-align: center; page-break-inside: avoid } .c svg { max-width: 70mm; height: auto } .n { font-size: 9pt }
    </style></head><body>${Array.from({ length: copies }, () => one).join('')}</body></html>`)
  }

  return (
    <>
      <PageHeader title="Barcode Designer" subtitle="Create and print a single barcode, with full control over its look." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-base font-semibold">Barcode settings</h2>
            <p className="text-sm text-ink-muted">Configure your barcode design and print settings.</p>
          </div>
          <Tabs<Mode> value={mode} onChange={setMode} tabs={[{ id: 'manual', label: 'Manual entry' }, { id: 'product', label: 'From product' }]} />

          {mode === 'manual' ? (
            <Field label="Barcode value">
              <div className="flex gap-2">
                <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Enter barcode value" maxLength={80} />
                <Button type="button" variant="secondary" onClick={() => setManual(randomValue(style.format))}><Shuffle size={15} /> Random</Button>
              </div>
            </Field>
          ) : (
            <Field label="Product">
              <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Choose a product</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.barcode})</option>)}
              </Select>
            </Field>
          )}

          <Field label="Barcode type" hint={typeHint}>
            <Select value={style.format} onChange={(e) => set('format', e.target.value)}>
              {BARCODE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>

          <div className="space-y-3 rounded-ctl border border-line p-3">
            <h3 className="text-sm font-semibold">Appearance</h3>
            <RangeField label="Line width" value={style.width} min={1} max={4} onChange={(v) => set('width', v)} />
            <RangeField label="Height" value={style.height} min={30} max={200} step={5} unit="px" onChange={(v) => set('height', v)} />
            <RangeField label="Font size" value={style.fontSize} min={8} max={32} unit="px" onChange={(v) => set('fontSize', v)} />
            <Toggle label="Show text" checked={style.displayValue} onChange={(v) => set('displayValue', v)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ColorField label="Background" value={style.background} onChange={(v) => set('background', v)} />
            <ColorField label="Line color" value={style.lineColor} onChange={(v) => set('lineColor', v)} />
          </div>

          <Field label="Copies">
            <NumberInput min={1} max={200} value={copies} onValue={setCopies} />
          </Field>

          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" onClick={reset}><RotateCcw size={15} /> Reset</Button>
            <Button variant="secondary" onClick={download} disabled={!result.ok}><Download size={15} /> Download</Button>
            <Button onClick={print} disabled={!result.ok}><Printer size={15} /> Print</Button>
          </div>
        </Card>

        <Card className="p-5 lg:sticky lg:top-20 lg:self-start">
          <h2 className="text-base font-semibold">Barcode preview</h2>
          <p className="text-sm text-ink-muted">Live preview of your barcode design.</p>
          <div className="mt-4 flex min-h-[220px] items-center justify-center rounded-ctl border border-dashed border-line bg-paper/50 p-4" data-testid="barcode-preview">
            {result.ok ? <BarcodeSvg value={value} style={style} className="max-w-full [&_svg]:h-auto [&_svg]:max-w-full" /> : (
              <p className="max-w-xs text-center text-sm text-ink-muted">{value ? result.error : 'Enter a barcode value to see the preview.'}</p>
            )}
          </div>
        </Card>
      </div>
    </>
  )
}
