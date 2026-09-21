# Architecture and design decisions

## 1. Data model

```
branches ─┬─< users                       (role admin: branch optional; manager/cashier: branch required)
          ├─< branch_inventory >─ products   (unique per product+branch; stock >= 0 enforced by the database)
          ├─< stock_movements >─ products    (append-only ledger: sale / transfer_out / transfer_in / adjustment)
          ├─< sales ─< sale_items >─ products  (price, cost and name are copied at sale time)
          ├─< z_reports                      (one per branch per business date)
          └─< stock_transfers (from / to) ─┬─< stock_transfer_items >─ products
                                           └─< stock_transfer_events                (audit log)
```

| Table | Purpose | Notable columns |
|---|---|---|
| `branches` | A shop | `code` (receipt prefix), `tax_number`, `tax_rate`, `receipt_header_text`, `receipt_footer_text`, `is_active` |
| `users` | Login accounts | `role` (CHECK admin/manager/cashier), `branch_id`, `password_hash` (bcrypt), `is_active` |
| `products` | Shared catalogue | `barcode` (unique), `category`, `flavor`, `nicotine_type`, `nicotine_strength`, `coil_resistance_ohm`, `device_variant`, `brand`, `buying_price`, `selling_price`, `is_active` |
| `branch_inventory` | Stock of one product at one branch | `stock_quantity` (CHECK >= 0), `min_threshold` (low-stock alert level) |
| `stock_movements` | Ledger of every stock change | `delta`, `reason`, `ref_type`/`ref_id`, `user_id`, `note` |
| `stock_transfers` | A transfer request | `from_branch_id`, `to_branch_id` (CHECK different), `status` (CHECK pending / in_transit / received / cancelled) |
| `stock_transfer_items` | Products in a transfer | `product_id`, `quantity` (CHECK > 0) |
| `stock_transfer_events` | Audit log | `status`, `user_id`, `note`, `created_at` - one row per status change |
| `sales` | A receipt | `receipt_number` (unique), `branch_id`, `cashier_id`, `subtotal`, `tax_rate`, `tax_amount`, `total_amount`, `payment_method`, `amount_tendered`, `change_due` |
| `sale_items` | Receipt lines | `product_name`, `unit_price`, `unit_cost` (snapshots), `quantity` |
| `z_reports` | A closed business day | totals, `opening_float`, `counted_cash`, `cash_variance`, `closed_by`; unique `(branch_id, business_date)` |

### Differences from the SQL in the original brief (and why)

| Brief | What was built | Reason |
|---|---|---|
| One product per `stock_transfers` row | Header table + `stock_transfer_items` | The brief's own workflow says "select products & quantities" (plural). One shipment usually carries many items. |
| No audit table | `stock_transfer_events` | The brief asks for an audit log of each status change. |
| Branch had no tax rate | `branches.tax_rate` | Receipts need to compute tax; rates differ per location. The rate is copied onto each sale so history never changes. |
| Product had flavor / strength text | Added `nicotine_type`, `coil_resistance_ohm` (numeric), `device_variant`, `brand`, `category` | The brief lists these attributes; numeric ohms can be filtered/sorted. Each variant is its own product (own barcode and stock) - the normal retail approach. |
| `sales` only | Added `sale_items`, `stock_movements`, `z_reports` | A receipt needs lines; stock changes need a ledger; end-of-day needs somewhere to be frozen. |

## 2. Who can do what

Enforced in the API (`app/deps.py`), mirrored in the UI only to hide buttons.

| Action | Cashier | Manager | Admin |
|---|:-:|:-:|:-:|
| Sign in | own branch | own branch | anywhere |
| Sell (POS) | own branch | own branch | any branch (choose in header) |
| View inventory | own branch | own branch | all / any branch |
| Adjust stock, change alert level | no | own branch | any branch |
| See cost price and profit | no | yes | yes |
| Dashboard analytics | no | own branch | all / any branch |
| Transfers: create | no | as sender (own branch) | any |
| Transfers: mark sent | no | own branch is the sender | any |
| Transfers: confirm received | no | own branch is the receiver | any |
| Transfers: cancel (before received) | no | either side | any |
| End of day: view / close | own branch | own branch | choose a branch |
| Products: create / edit / hide | no | view only | yes |
| Branches, staff accounts | no | no | yes |

**The branch lock.** `scope_branch(user, requested_branch_id)` is called by every endpoint that reads or writes branch data.
For admins it returns whatever was asked (or `None` = all). For managers/cashiers it returns their own branch, and raises **403** if the request names a different one. A cashier cannot sell "as" another branch by editing the request: the branch comes from their login.

## 3. Transfer lifecycle

```
            request                    "mark as sent"                  "confirm delivery"
 (none) ───────────────▶  pending  ───────────────────▶  in_transit  ───────────────────▶  received
            sender/admin      │        sender/admin           │            receiver/admin        (stock moves here)
                              │                               │
                              └───────────── cancel ──────────┴──▶ cancelled   (either branch/admin; no stock change)
```

* **Stock moves only at `received`**, as the brief specifies. Inside one database transaction the API: locks the transfer row, locks every affected stock row (source and destination, sorted), re-verifies that the source still has enough, subtracts from source, adds to destination, writes two `stock_movements` per item, records the event.
* If the source no longer has enough (for example it sold the goods while they were in the van) the receive is refused with **409** and *nothing* moves, not even the items that were available. Fix the source count and try again.
* Consequence to be aware of: while a transfer is `in_transit`, the goods still count as the sender's stock and can be sold there. If you prefer "deduct on dispatch", the change is confined to `routers/transfers.py` (move the source-decrement into `dispatch_transfer` and add an "un-dispatch" on cancel).
* Each step adds a row to `stock_transfer_events` (who, what status, when, optional note), shown as the History timeline in the UI.

## 4. Sale flow and money rules

* Shelf prices are **tax-exclusive**. `tax = round_half_up(subtotal x branch.tax_rate / 100)`; `total = subtotal + tax`. All arithmetic is `Decimal` on the server and integer cents in the UI.
* Cash sales require `amount_tendered >= total`; change is stored. Card sales store `tendered = total`.
* `sale_items` copy name, price and cost, so later price edits never rewrite history and profit reports stay correct.
* Receipt numbers look like `RS-260921-3F9A1C`: branch code, date, random suffix. They are unique per database.
* There are **no refunds/voids yet** (see roadmap).

## 5. Reports

* **Business day** = calendar day in `BUSINESS_TIMEZONE`, computed with DST-safe boundaries (`services/timeutils.py`); the dashboard groups by `date(timezone(tz, created_at))` in SQL.
* **Z-Report** (`/reports/z-report`) is live until closed. Closing (`POST /reports/z-report/close`) copies the totals into `z_reports` so they can never change, and stores opening float, counted cash and the variance `counted - (float + cash sales)`. A day can be closed once per branch; future days cannot be closed. Sales rung up after closing are not included in the frozen report (they show in the dashboard).
* **Dashboard:** KPIs, daily series per branch, per-branch totals, top flavors, top devices (category `device`), and the low-stock list (`stock <= min_threshold`).

## 6. Real-time

```
 router: background.add_task(manager.publish, "sale.created", [branch_id], {...})
   -> ConnectionManager (in memory) -> WebSocket clients: admins always, others only if branch matches
   -> browser: useRealtime.ts -> queryClient.invalidateQueries(...) -> screens refetch
```

Events: `sale.created`, `inventory.changed`, `transfer.updated`, `product.updated`, `branch.updated`, `zreport.closed`. Messages contain ids only, never business data; the browser refetches through the normal, permission-checked API.

**Limitation:** the list of connected clients is in the memory of one process, so run a single Uvicorn worker. To scale to many workers or servers, replace the body of `ConnectionManager.publish` with Redis pub/sub or PostgreSQL `LISTEN/NOTIFY` and have each worker relay the messages to its own sockets. Nothing else in the code needs to change.

## 7. Security notes

* Passwords: bcrypt. Tokens: HS256 JWT, 12 h. The user is reloaded from the DB on each request, so disabling an account is immediate.
* SQL injection: not possible through the ORM (parameterised queries).
* The API refuses to start with the placeholder `SECRET_KEY` when `ENVIRONMENT=production`.
* Cost price is removed from product responses for cashiers.
* The database container publishes no port to the host.
* Not included: login rate limiting / lockout, password reset by e-mail, two-factor login. Put the app behind HTTPS (see DEPLOYMENT.md) and consider fail2ban or your reverse proxy's rate limiter for `/api/v1/auth/login`.
* The JWT is kept in `localStorage`, which is typical for internal tools; it is readable by any script running on the page, so never add third-party scripts to the frontend.

## 8. Testing approach

20 tests run the real FastAPI app against a real PostgreSQL database (not a mock, not SQLite), because the correctness of the system depends on database behaviour: locks, constraints and timezone maths. The concurrency test runs two sales in parallel threads for the last unit in stock and asserts exactly one succeeds.
The frontend is verified by `tsc` (strict) and a production build; there are no automated UI tests.

## 9. Roadmap / not built

* Refunds, returns and voided sales (with stock return and manager approval)
* Age / ID verification prompts and a log (vape retail is regulated almost everywhere; check your local rules for age limits, taxes, licensing and product registration - the software does not enforce them)
* Offline mode for a dropped internet connection (the POS needs the server today)
* Direct thermal-printer support (ESC/POS); today receipts print through the browser
* Suppliers, purchase orders and goods-received notes
* Per-category tax / excise rules and discounts / promotions
* Login rate limiting, password reset, two-factor authentication
* Multi-worker real-time (see section 6)
* Product images, customer accounts / loyalty
