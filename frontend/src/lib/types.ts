// TypeScript shapes of the API responses (mirror backend/app/schemas.py)
export type Role = 'admin' | 'manager' | 'cashier'
export type PaymentMethod = 'cash' | 'card'
export type TransferStatus = 'pending' | 'in_transit' | 'received' | 'cancelled'

export interface User {
  id: number
  username: string
  full_name: string
  role: Role
  branch_id: number | null
  branch_name: string | null
  is_active: boolean
}

export interface Branch {
  id: number
  name: string
  code: string
  address: string | null
  phone: string | null
  tax_number: string | null
  tax_rate: number
  receipt_header_text: string | null
  receipt_footer_text: string | null
  is_active: boolean
}

export interface Product {
  id: number
  barcode: string
  name: string
  brand: string | null
  category: string | null
  flavor: string | null
  nicotine_type: string
  nicotine_strength: string | null
  coil_resistance_ohm: number | null
  device_variant: string | null
  selling_price: number
  buying_price?: number | null
  is_active: boolean
}

export interface InventoryRow {
  product: Product
  branch_id: number
  branch_name: string
  stock_quantity: number
  min_threshold: number
  is_low: boolean
}

export interface TransferItem { product_id: number; product_name: string; barcode: string; quantity: number }
export interface TransferEvent { id: number; status: TransferStatus; username: string | null; note: string | null; created_at: string }
export interface Transfer {
  id: number
  reference: string
  from_branch_id: number
  from_branch_name: string
  to_branch_id: number
  to_branch_name: string
  status: TransferStatus
  note: string | null
  created_by_name: string | null
  created_at: string
  items: TransferItem[]
  events: TransferEvent[]
}

export interface SaleItem { product_id: number; product_name: string; quantity: number; unit_price: number; line_total: number }
export interface Sale {
  id: number
  receipt_number: string
  branch: Branch
  cashier_name: string | null
  subtotal: number
  tax_rate: number
  tax_amount: number
  total_amount: number
  payment_method: PaymentMethod
  amount_tendered: number | null
  change_due: number | null
  created_at: string
  items: SaleItem[]
}

export interface ZTotals {
  branch_id: number
  branch_name: string
  business_date: string
  receipts_count: number
  items_sold: number
  subtotal: number
  tax_total: number
  gross_total: number
  cash_total: number
  card_total: number
}
export interface ZReport extends Omit<ZTotals, 'branch_name'> {
  id: number
  branch: Branch
  opening_float: number
  counted_cash: number | null
  cash_variance: number | null
  notes: string | null
  closed_by_name: string | null
  closed_at: string
}
export interface ZReportView { totals: ZTotals; closure: ZReport | null }

export interface TopItem { label: string; quantity: number; revenue: number }
export interface Dashboard {
  days: number
  kpis: {
    today_sales: number
    today_receipts: number
    period_sales: number
    period_receipts: number
    period_profit: number | null
    low_stock_count: number
  }
  by_branch: { branch_id: number; branch_name: string; total: number; receipts: number }[]
  daily: { dates: string[]; series: { branch_id: number; branch_name: string; values: number[] }[] }
  top_flavors: TopItem[]
  top_devices: TopItem[]
  low_stock: { product_id: number; product_name: string; branch_id: number; branch_name: string; stock_quantity: number; min_threshold: number }[]
}
