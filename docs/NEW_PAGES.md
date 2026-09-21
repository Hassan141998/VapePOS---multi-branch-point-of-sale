# New pages and features

Everything here is in the sidebar, grouped as **Main / Tools / Reports / Manage**.
Pages an account cannot use are hidden from its sidebar.

| Page | Who | What it does |
|---|---|---|
| **Sales** | everyone | Every receipt, filtered by date and receipt number. Open one to view or reprint it. Cashiers see their own branch only. |
| **Categories** | staff view, admin edits | Add, rename and delete product categories. Renaming moves the products. A category that products use cannot be deleted. |
| **Discounts** | staff view, admin edits | Percentage or fixed-amount promotions for all items, one category or one product, with an optional minimum purchase and start and end dates. Cashiers pick an active discount at the till. |
| **Barcode Designer** | staff | Draw one barcode (Code 128, Code 39, EAN-13, UPC-A, EAN-8, ITF-14), adjust its look, then download it as a PNG or print copies. |
| **Barcode Generator** | staff | Choose products and print labels: small, medium or large, on a label printer or an A4 sheet. |
| **Receipt Designer** | admin | Width, font, logo, which header, content and footer lines to show, an optional receipt barcode, and auto-print after each sale. Live preview. |
| **Reports** | staff | Revenue, transactions, average sale and items sold for a date range, filtered by product and category. Chart, best sellers, CSV export and print. |
| **Data Export** | admin | Download a ZIP (data.json plus one CSV per table) or import one back. |
| **System Settings** | admin | Business name, email, website and currency (Pakistani rupees by default). |

## How discounts are calculated

The total is worked out in whole cents so the till and the server always agree:

1. Items total = quantity x price for every line.
2. The discount is taken off the eligible lines only. A fixed amount is capped at the eligible total and shared out in proportion to each line.
3. Tax is charged on what is left (items total minus the discount).
4. Total = items total - discount + tax.

A receipt stores the discount code and amount, so deleting a discount later does not change past receipts.
`sales.subtotal` is the amount after the discount, so `subtotal + tax = total` always holds and End of day needs no change.

**Reports revenue** means item prices after discounts and before tax, so it can be split by product and category.
The dashboard "Sales" figure includes tax, so the two pages can show different numbers for the same day.

## Data export and import

* **Exported:** branches, categories, products, stock levels, discounts, settings (business and receipt), staff list and sales history.
  Passwords are never exported.
* **Imported:** branches, categories, products, stock levels, discounts and settings. Rows are matched by branch code, product barcode, category name and discount code, and are **merged**. Nothing is deleted.
  Staff and sales are kept in the export for your records but are not imported.
* Files larger than 4 MB cannot be imported (a Vercel limit). Untick "Include sales history" to make a small file.
* Exports are also limited to about 4.5 MB by Vercel. For a very large history, export without sales.

## Updating an existing database

After pulling this version, run once against your database (use the direct, non-pooler connection string):

    cd backend
    alembic upgrade head

This adds the categories, discounts and settings tables and the discount columns on sales.
Your existing products' categories are copied into the Categories page automatically.

## Currency

The default is Pakistani rupees, written `Rs 1,234.50`. Change it in System Settings.
`VITE_CURRENCY` (frontend build setting) only changes the currency shown before the settings finish loading.
The demo data (`python -m app.seed`) uses small dollar-sized prices, so amounts look small in rupees. Enter your own prices for real use.
