import type { BusinessSettings, ReceiptDesign } from './types'

/** Same defaults as the backend (schemas.py), used until the real settings arrive. */
export const DEFAULT_BUSINESS: BusinessSettings = {
  business_name: 'VapePOS', email: null, website: null, currency: 'PKR', currency_symbol: 'Rs',
}
export const DEFAULT_RECEIPT: ReceiptDesign = {
  width_px: 300, font_size: 12, font_family: 'Arial', print_after_sale: false,
  show_logo: false, logo_data_url: null, show_business_name: false, show_address: false, show_phone: false,
  show_email: false, show_website: false, show_tax_number: true, header_extra: '',
  show_receipt_number: true, show_datetime: true, show_cashier: true, show_item_barcode: false,
  show_unit_price: true, show_tax_line: true, show_payment: true,
  show_branch_footer: true, footer_text: '', return_policy: '', show_receipt_barcode: false,
}
