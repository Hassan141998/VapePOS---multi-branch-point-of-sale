/**
 * Cart pricing: discounts and tax, in integer cents with round-half-up.
 * This MIRRORS backend/app/services/pricing.py so the total shown at the till is exactly what the
 * server charges. If you change one, change the other (the parity check in the docs compares them).
 */
import type { Discount } from './types'

export interface CartLine { productId: number; category: string | null; unitCents: number; qty: number }
export interface Priced {
  itemsTotal: number
  lineDiscounts: number[]
  discount: number
  net: number
  tax: number
  total: number
  /** Set when the chosen discount cannot be used on this cart (the discount is then NOT applied). */
  discountError: string | null
}

export const toCents = (n: number) => Math.round(n * 100)
const halfUp = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den))

type Rule = Pick<Discount, 'type' | 'value' | 'applies_to' | 'category' | 'product_id' | 'min_purchase' | 'name'>

function eligible(rule: Rule, line: CartLine): boolean {
  if (rule.applies_to === 'all') return true
  if (rule.applies_to === 'category') return line.category != null && line.category === rule.category
  return line.productId === rule.product_id
}

function allocate(lines: CartLine[], rule: Rule): number[] {
  const idx = lines.map((l, i) => (eligible(rule, l) ? i : -1)).filter((i) => i >= 0)
  const total = (l: CartLine) => l.unitCents * l.qty
  const eligibleTotal = idx.reduce((s, i) => s + total(lines[i]), 0)
  if (idx.length === 0 || eligibleTotal <= 0) throw new Error(`'${rule.name}' does not apply to anything in this cart.`)
  const minCents = toCents(rule.min_purchase)
  if (eligibleTotal < minCents) throw new Error(`'${rule.name}' needs at least ${(minCents / 100).toFixed(2)} of eligible items in the cart.`)

  const out = new Array<number>(lines.length).fill(0)
  if (rule.type === 'percent') {
    const bp = toCents(rule.value) // 12.5 % -> 1250 basis points
    for (const i of idx) out[i] = halfUp(total(lines[i]) * bp, 10000)
  } else {
    const target = Math.min(toCents(rule.value), eligibleTotal)
    let given = 0
    for (const i of idx.slice(0, -1)) {
      out[i] = Math.min(halfUp(target * total(lines[i]), eligibleTotal), total(lines[i]))
      given += out[i]
    }
    const last = idx[idx.length - 1]
    out[last] = Math.max(0, Math.min(target - given, total(lines[last])))
  }
  return out
}

export function priceCart(lines: CartLine[], taxRatePercent: number, discount: Rule | null = null): Priced {
  const itemsTotal = lines.reduce((s, l) => s + l.unitCents * l.qty, 0)
  let lineDiscounts = new Array<number>(lines.length).fill(0)
  let discountError: string | null = null
  if (discount && lines.length > 0) {
    try { lineDiscounts = allocate(lines, discount) } catch (e) { discountError = (e as Error).message }
  }
  const discountTotal = lineDiscounts.reduce((s, d) => s + d, 0)
  const net = itemsTotal - discountTotal
  const tax = halfUp(net * toCents(taxRatePercent), 10000)
  return { itemsTotal, lineDiscounts, discount: discountTotal, net, tax, total: net + tax, discountError }
}
