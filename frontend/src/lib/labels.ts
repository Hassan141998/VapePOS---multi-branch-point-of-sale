import { escapeHtml } from './files'

export interface LabelSize { id: string; name: string; w: number; h: number }
export const LABEL_SIZES: LabelSize[] = [
  { id: 'small', name: 'Small (38 x 25 mm)', w: 38, h: 25 },
  { id: 'medium', name: 'Medium (50 x 30 mm)', w: 50, h: 30 },
  { id: 'large', name: 'Large (70 x 40 mm)', w: 70, h: 40 },
]
export type LabelLayout = 'label-printer' | 'a4'

export interface Label { svg: string; name?: string; price?: string }

/** A complete HTML document for printing labels. `svg` strings come from JsBarcode; text is escaped here. */
export function labelSheetHtml(labels: Label[], size: LabelSize, layout: LabelLayout): string {
  const barMax = size.h - (labels.some((l) => l.name) ? 7 : 2) - (labels.some((l) => l.price) ? 5 : 0)
  const page = layout === 'label-printer'
    ? `@page { size: ${size.w}mm ${size.h}mm; margin: 0 } .label { page-break-after: always; }`
    : `@page { size: A4; margin: 8mm } body { display: flex; flex-wrap: wrap; gap: 2mm; align-content: flex-start } .label { border: 0.2mm dashed #bbb; }`
  const body = labels.map((l) => `
    <div class="label">
      ${l.name ? `<div class="name">${escapeHtml(l.name)}</div>` : ''}
      <div class="bar">${l.svg}</div>
      ${l.price ? `<div class="price">${escapeHtml(l.price)}</div>` : ''}
    </div>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
    * { box-sizing: border-box } body { margin: 0; font-family: Arial, sans-serif; color: #000 }
    .label { width: ${size.w}mm; height: ${size.h}mm; padding: 1mm 1.5mm; display: flex; flex-direction: column; align-items: center; justify-content: center; overflow: hidden; page-break-inside: avoid }
    .name { max-width: 100%; font-size: 7pt; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
    .price { font-size: 8pt; font-weight: 700 }
    .bar { width: 100%; display: flex; justify-content: center }
    .bar svg { width: 100%; height: auto; max-height: ${Math.max(barMax, 8)}mm }
    ${page}
  </style></head><body>${body}</body></html>`
}
