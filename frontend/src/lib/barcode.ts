import JsBarcode from 'jsbarcode'

export const BARCODE_TYPES = [
  { value: 'CODE128', label: 'Code 128', hint: 'Any letters, digits and symbols. Works for every product barcode.' },
  { value: 'CODE39', label: 'Code 39', hint: 'Capital letters, digits and - . $ / + % space.' },
  { value: 'EAN13', label: 'EAN-13', hint: '12 or 13 digits (the last digit is the check digit).' },
  { value: 'UPC', label: 'UPC-A', hint: '11 or 12 digits (the last digit is the check digit).' },
  { value: 'EAN8', label: 'EAN-8', hint: '7 or 8 digits.' },
  { value: 'ITF14', label: 'ITF-14', hint: '13 or 14 digits.' },
] as const

export interface BarcodeStyle {
  format: string
  width: number       // bar width in px (1-4)
  height: number      // bar height in px
  fontSize: number
  displayValue: boolean
  background: string
  lineColor: string
  margin?: number
}
export const DEFAULT_STYLE: BarcodeStyle = {
  format: 'CODE128', width: 2, height: 100, fontSize: 16, displayValue: true, background: '#ffffff', lineColor: '#000000', margin: 10,
}

export type BarcodeResult = { ok: true; svg: string } | { ok: false; error: string }

/** Draw a barcode as SVG markup. Never throws: an unusable value comes back as { ok: false, error }. */
export function barcodeSvg(value: string, style: BarcodeStyle): BarcodeResult {
  if (!value) return { ok: false, error: 'Enter a value to see the barcode.' }
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    JsBarcode(svg, value, {
      format: style.format, width: style.width, height: style.height, displayValue: style.displayValue,
      fontSize: style.fontSize, background: style.background, lineColor: style.lineColor, margin: style.margin ?? 10,
      textMargin: 2,
    })
    // scale with its container instead of a fixed pixel size
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    return { ok: true, svg: svg.outerHTML }
  } catch {
    const hint = BARCODE_TYPES.find((t) => t.value === style.format)?.hint
    return { ok: false, error: `"${value}" cannot be drawn as ${style.format}. ${hint ?? ''}`.trim() }
  }
}

export function randomValue(format: string): string {
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')
  switch (format) {
    case 'EAN13': return digits(12)
    case 'UPC': return digits(11)
    case 'EAN8': return digits(7)
    case 'ITF14': return digits(13)
    case 'CODE39': return Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')
    default: return digits(10)
  }
}

/** SVG markup -> PNG blob (for the Download button). */
export function svgToPng(svgMarkup: string, scale = 3): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml').documentElement
    const w = Number(doc.getAttribute('width')?.replace('px', '')) || 300
    const h = Number(doc.getAttribute('height')?.replace('px', '')) || 150
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w * scale
      canvas.height = h * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) return reject(new Error('Canvas is not available'))
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image'))), 'image/png')
    }
    img.onerror = () => reject(new Error('Could not create the image'))
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup)
  })
}
