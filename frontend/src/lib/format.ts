const currency = import.meta.env.VITE_CURRENCY ?? 'USD'
const moneyFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency })
const compactFmt = new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 })

export const money = (n: number | null | undefined) => (n == null ? '-' : moneyFmt.format(n))
export const moneyCompact = (n: number) => compactFmt.format(n)

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
export const CATEGORIES = Object.keys(categoryLabel)
