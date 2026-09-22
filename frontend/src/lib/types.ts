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
  created_at?: string | null
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

export interface SaleItem { product_id: number; product_name: string; barcode?: string | null; quantity: number; unit_price: number; discount_amount?: number; line_total: number }
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
  discount_amount?: number
  discount_code?: string | null
  discount_name?: string | null
  created_at: string
  items: SaleItem[]
}
export interface SaleSummary {
  id: number
  receipt_number: string
  branch_id: number
  cashier_name: string | null
  total_amount: number
  payment_method: PaymentMethod
  created_at: string
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

export interface Category { id: number; name: string; description: string | null; product_count: number }

export type DiscountType = 'percent' | 'fixed'
export type DiscountScope = 'all' | 'category' | 'product'
export type DiscountStatus = 'active' | 'scheduled' | 'expired' | 'disabled'
export interface Discount {
  id: number
  name: string
  code: string
  type: DiscountType
  value: number
  applies_to: DiscountScope
  category: string | null
  product_id: number | null
  product_name: string | null
  min_purchase: number
  starts_on: string | null
  ends_on: string | null
  is_active: boolean
  status: DiscountStatus
}

export interface BusinessSettings {
  business_name: string
  email: string | null
  website: string | null
  currency: string
  currency_symbol: string | null
}
export type ReceiptFont = 'Arial' | 'Courier New' | 'Georgia' | 'Tahoma' | 'Times New Roman' | 'Verdana'
export interface ReceiptDesign {
  width_px: number
  font_size: number
  font_family: ReceiptFont
  print_after_sale: boolean
  show_logo: boolean
  logo_data_url: string | null
  show_business_name: boolean
  show_address: boolean
  fallback_address: string
  show_phone: boolean
  fallback_phone: string
  show_email: boolean
  show_website: boolean
  show_tax_number: boolean
  header_extra: string
  show_receipt_number: boolean
  show_datetime: boolean
  show_cashier: boolean
  show_item_barcode: boolean
  show_unit_price: boolean
  show_tax_line: boolean
  show_payment: boolean
  show_branch_footer: boolean
  footer_text: string
  return_policy: string
  show_receipt_barcode: boolean
}
export interface Settings { business: BusinessSettings; receipt: ReceiptDesign; timezone: string }

export interface SalesReport {
  date_from: string
  date_to: string
  totals: { revenue: number; transactions: number; avg_transaction: number; items_sold: number; discounts: number }
  daily: { date: string; revenue: number; transactions: number }[]
  top_products: { product_id: number; name: string; category: string | null; quantity: number; revenue: number }[]
  by_category: { category: string; quantity: number; revenue: number }[]
}

export interface ImportResult { created: Record<string, number>; updated: Record<string, number>; skipped: string[] }
