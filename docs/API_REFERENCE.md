# API reference

Base URL: `/api/v1`. Interactive version (try requests in the browser): `/api/v1/docs`.
Machine-readable spec: `/api/v1/openapi.json`.

All endpoints except `POST /auth/login` and `GET /health` need the header `Authorization: Bearer <token>`.
Money values are JSON numbers with two decimals. Timestamps are ISO 8601 in UTC.

**Access column:** *all* = any signed-in user; *scoped* = managers and cashiers are limited to their own branch (403 otherwise), admins may pass any `branch_id` or omit it for "all locations".

## Try it with curl

```bash
# 1. sign in (form-encoded, not JSON)
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -d 'username=cashier1&password=cashier1234' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# 2. what is in stock at my branch?
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8080/api/v1/inventory?search=mango"

# 3. ring up a sale: 2 x product 1, paid in cash with a 50 note
curl -s -X POST http://localhost:8080/api/v1/sales \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"items":[{"product_id":1,"quantity":2}],"payment_method":"cash","amount_tendered":50}'
```

## Endpoints

### Auth

| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/auth/login` | public | Form fields `username`, `password`. Returns `{access_token, token_type, user}`. Managers/cashiers of an inactive branch are refused (403). |
| `GET` | `/auth/me` | all | The signed-in user's profile. |

### Branches

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/branches` | all | Active branches (`include_inactive=true` works for admins only). |
| `GET` | `/branches/{id}` | all | One branch. |
| `POST` | `/branches` | admin | Create. Also creates zero-stock inventory rows for every product. Body: `name`, `code`, `address`, `phone`, `tax_number`, `tax_rate`, `receipt_header_text`, `receipt_footer_text`, `is_active`. |
| `PUT` | `/branches/{id}` | admin | Partial update. |
| `DELETE` | `/branches/{id}` | admin | Deactivates (history is kept). |

### Users

All admin only.

| Method | Path | Description |
|---|---|---|
| `GET` | `/users` | List accounts. |
| `POST` | `/users` | Create. `role` is `admin`, `manager` or `cashier`; managers and cashiers require `branch_id`. Password 8-72 characters. |
| `PUT` | `/users/{id}` | Update name, role, branch, active flag, and optionally a new `password`. You cannot demote or disable yourself. |

### Products

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/products` | all | Query: `search` (name, barcode, brand, flavor), `category`, `include_inactive`, `limit`, `offset`. `buying_price` is `null` for cashiers. |
| `GET` | `/products/barcode/{barcode}` | all | Exact barcode lookup (scanner). 404 if unknown. |
| `POST` | `/products` | admin | Create. Also creates a zero-stock row at every branch. 409 on duplicate barcode. Fields: `barcode`, `name`, `brand`, `category` (`device`, `pod`, `coil`, `e-liquid`, `disposable`, `accessory`), `flavor`, `nicotine_type` (`none`, `freebase`, `salt`), `nicotine_strength`, `coil_resistance_ohm`, `device_variant`, `buying_price`, `selling_price`, `is_active`. |
| `PUT` | `/products/{id}` | admin | Partial update. |
| `DELETE` | `/products/{id}` | admin | Hides the product (`is_active=false`); it is never hard-deleted. |

### Inventory

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/inventory` | scoped | Rows of `{product, branch_id, branch_name, stock_quantity, min_threshold, is_low}`. Query: `branch_id`, `search`, `category`, `low_stock_only`. |
| `PUT` | `/inventory/{branch_id}/{product_id}/threshold` | admin, manager (own branch) | Body `{min_threshold}`. |
| `POST` | `/inventory/adjust` | admin, manager (own branch) | Body `{branch_id?, product_id, delta, set_to, note?}` - provide exactly one of `delta` (add or remove units) or `set_to` (exact count). Cannot go below zero. Writes a ledger entry. |
| `GET` | `/inventory/movements` | admin, manager | Stock ledger, newest first. Query: `branch_id`, `product_id`, `limit`. |

### Transfers

Admin and manager only. Managers see transfers that involve their branch.

| Method | Path | Who may act | Description |
|---|---|---|---|
| `GET` | `/transfers` | admin, manager | Query: `status`, `branch_id` (admin), `limit`. |
| `GET` | `/transfers/{id}` | involved branch, admin | Includes `items` and the audit `events`. |
| `POST` | `/transfers` | admin; manager of the sending or receiving branch | Body `{from_branch_id, to_branch_id, note?, items:[{product_id, quantity}]}`. Refused (409) if the sender lacks stock. Status `pending`. |
| `POST` | `/transfers/{id}/dispatch` | sending branch, admin | `pending` -> `in_transit`. Body optional `{note}`. |
| `POST` | `/transfers/{id}/receive` | receiving branch, admin | `in_transit` -> `received`. Moves the stock atomically; 409 (nothing moved) if the sender no longer has enough. |
| `POST` | `/transfers/{id}/cancel` | either branch, admin | Allowed while `pending` or `in_transit`. |

### Sales

| Method | Path | Access | Description |
|---|---|---|---|
| `POST` | `/sales` | all | Body `{items:[{product_id, quantity}], payment_method ("cash" or "card"), amount_tendered?, branch_id? (admin only)}`. Locks stock, checks availability (409 if short), computes tax with the branch rate, decrements stock, returns the full receipt. Cash tendered below the total is a 400. |
| `GET` | `/sales` | scoped | Recent sales. Query: `branch_id`, `business_date`, `limit`. |
| `GET` | `/sales/{id}` | scoped | One receipt with its lines and branch details. |

### Reports

| Method | Path | Access | Description |
|---|---|---|---|
| `GET` | `/reports/z-report` | scoped (admin must pass `branch_id`) | Query: `branch_id`, `business_date` (default: today in the business timezone). Returns live `totals` and the saved `closure` if the day was closed. |
| `POST` | `/reports/z-report/close` | scoped | Body `{branch_id?, business_date?, opening_float?, counted_cash?, notes?}`. Freezes the day. 409 if already closed, 400 for a future date. |
| `GET` | `/reports/z-reports` | scoped | History of closed days. |
| `GET` | `/reports/dashboard` | admin, manager | Query: `branch_id`, `days` (1-90). KPIs, daily series per branch, per-branch totals, top flavors, top devices, low-stock list. |

### System

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | `{"status":"ok"}` if the API can reach the database. |

### WebSocket

`GET /api/v1/ws?token=<JWT>` (upgrade to WebSocket). Invalid tokens are closed with code 4401.
Messages from the server:

```json
{"type": "inventory.changed", "branch_ids": [2], "data": {"product_ids": [7]}, "at": "2026-09-21T14:03:11Z"}
```

Types: `sale.created`, `inventory.changed`, `transfer.updated`, `product.updated`, `branch.updated`, `zreport.closed`.
Admins receive every event; other users only events whose `branch_ids` include their branch (or that have none).
Send the text `ping` occasionally; the server answers `pong`.

## Error format

```json
{"detail": "Not enough stock for 'Mango Ice 20mg': 1 left, 2 in cart."}
```

Validation errors (422) return `detail` as a list of `{loc, msg, type}` objects.
