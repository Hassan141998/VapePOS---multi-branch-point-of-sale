/**
 * Money formatting. The default is Pakistani rupees (Rs). The shop can change the currency and
 * symbol in System Settings; Layout applies them with setCurrency as soon as they load.
 * VITE_CURRENCY can change the starting currency for a build (e.g. VITE_CURRENCY=USD).
 */
const DEFAULT_CODE = 'PKR'
/** Currencies whose usual written form is a short word (Rs, not "PKR"). */
const HOUSE_SYMBOL: Record<string, string> = { PKR: 'Rs' }

let currency = ((import.meta.env.VITE_CURRENCY as string | undefined) ?? DEFAULT_CODE).toUpperCase()
let symbol: string | null = HOUSE_SYMBOL[currency] ?? null
let moneyFmt: Intl.NumberFormat
let compactFmt: Intl.NumberFormat

function build() {
  try {
    moneyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency })
    compactFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })
  } catch {
    currency = DEFAULT_CODE
    symbol = HOUSE_SYMBOL[DEFAULT_CODE]
    moneyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency })
    compactFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })
  }
}
build()
const plainFmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const plainCompact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

/** "Rs 1,234.50" (a word symbol gets a space; a sign like $ or \u20AC does not). */
const withSymbol = (sym: string, n: number, fmt: Intl.NumberFormat) =>
  `${n < 0 ? '-' : ''}${sym}${/[A-Za-z.]$/.test(sym) ? ' ' : ''}${fmt.format(Math.abs(n))}`

/** Format an amount in any currency (used for the live example in System Settings). */
export function formatMoney(n: number, code: string, customSymbol?: string | null): string {
  const sym = customSymbol?.trim() || HOUSE_SYMBOL[code.toUpperCase()]
  try {
    return sym ? withSymbol(sym, n, plainFmt) : new Intl.NumberFormat(undefined, { style: 'currency', currency: code.toUpperCase() }).format(n)
  } catch { return '-' }
}

export function setCurrency(code: string, customSymbol?: string | null): string {
  const next = (code || DEFAULT_CODE).toUpperCase()
  const nextSymbol = customSymbol?.trim() || HOUSE_SYMBOL[next] || null
  if (next !== currency || nextSymbol !== symbol) { currency = next; symbol = nextSymbol; build() }
  return `${currency}|${symbol ?? ''}`  // a key that changes when the format does
}
export const currencyCode = () => currency

export const money = (n: number | null | undefined) => (n == null ? '-' : symbol ? withSymbol(symbol, n, plainFmt) : moneyFmt.format(n))
export const moneyCompact = (n: number) => (symbol ? withSymbol(symbol, n, plainCompact) : compactFmt.format(n))

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
export const timeOnly = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { timeStyle: 'short' })
export const shortDay = (isoDate: string) =>
  new Date(isoDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** Local calendar date as YYYY-MM-DD (used for the Z-report date picker). */
export const todayISO = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const statusLabel: Record<string, string> = {
  pending: 'Pending',
  in_transit: 'In transit',
  received: 'Received',
  cancelled: 'Cancelled',
}

export const categoryLabel: Record<string, string> = {
  device: 'Devices',
  pod: 'Pods',
  coil: 'Coils',
  'e-liquid': 'E-liquids',
  disposable: 'Disposables',
  accessory: 'Accessories',
}
/** The six original categories have friendly plural labels; any category you add is shown exactly as typed. */
export const catLabel = (name: string | null | undefined) => (name ? (categoryLabel[name] ?? name) : '-')

/** "10%" or "Rs 5.00" */
export const discountValue = (d: { type: string; value: number }) => (d.type === 'percent' ? `${d.value}%` : money(d.value))
