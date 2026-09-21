# Tools guide - every tool in VapePOS, what it does and how to use it

This guide walks through **every tool** used in the project, in the order you meet them.
For each one you get: what it is (plain words), why it is in this project, where to find it in the
code, the commands you will actually type, and the mistakes people commonly make.

Versions below are the ones the project was built and tested with. Newer minor versions should work.

**Contents**

1. [The big picture](#1-the-big-picture)
2. [Working tools: terminal, Git, editor](#2-working-tools)
3. [Infrastructure: Docker, Docker Compose, nginx, PostgreSQL](#3-infrastructure)
4. [Backend: Python, FastAPI, Uvicorn, Pydantic, SQLAlchemy, psycopg, Alembic, PyJWT, bcrypt, pytest](#4-backend)
5. [Frontend: Node, npm, Vite, TypeScript, React, React Router, TanStack Query, Zustand, Axios, Tailwind, Recharts, lucide, clsx, Fontsource](#5-frontend)
6. [Ideas you will meet: JWT, WebSockets, row locking, migrations](#6-key-ideas)
7. [Follow one sale through every tool](#7-follow-one-sale)
8. [Everyday command cheat sheet](#8-cheat-sheet)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. The big picture

```
   Cashier's browser (React app)                         Manager's phone (same React app)
            |   HTTPS + WebSocket                                |
            v                                                    v
        +--------------------- nginx (serves the app, forwards /api) ---------------------+
                                            |
                                            v
                             FastAPI backend (Python)
                     checks login, applies rules, talks to the database
                                            |
                                            v
                                  PostgreSQL database
                       (branches, users, products, stock, sales, transfers ...)
```

* The **frontend** is what people see: buttons, tables, charts. It runs in the browser.
* The **backend** is the brain. It is the only thing allowed to change data, and it checks *who is asking*
  and *which branch they belong to* on every single request. Hiding a button in the frontend is a
  courtesy; the backend check is the real lock.
* The **database** is the single source of truth shared by all branches.
* **Docker** packages all three so they run identically on your laptop and on a server.

---

## 2. Working tools

### Terminal (command line)
Where you type commands. Windows: *PowerShell* or *Windows Terminal* (PyCharm's built-in Terminal is PowerShell). PowerShell 5 does not understand `&&`, `source` or `cp -r`: type one command per line, activate a venv with `.venv\Scripts\Activate.ps1`, copy files with `Copy-Item`. Mac: *Terminal*. Linux: any.
Commands in this guide starting with `$` are typed in the terminal (do not type the `$`).

Useful basics: `cd folder` (go into a folder), `ls` / `dir` (list files), `pwd` (where am I), `Ctrl+C` (stop a running program).

### Git (version control)
**What:** records every change to your code so you can go back, compare, and collaborate.
**Why here:** the project ships with a `.gitignore` so secrets (`.env`) and junk (`node_modules`) are never committed.
**Install:** <https://git-scm.com/downloads>.
```bash
git init                      # start tracking this folder
git add -A && git commit -m "First version"
git log --oneline             # history
git diff                      # what did I change?
```
**Rule #1:** never commit `.env`. It holds your database password and signing key.

### Code editor
Any works. **VS Code** is a good default. Helpful extensions: *Python*, *ESLint* (optional), *Tailwind CSS IntelliSense*, *Docker*.

---

## 3. Infrastructure

### Docker
**What:** runs programs inside lightweight sealed boxes called *containers*. A container carries its own copy of Python/Node/etc., so "it works on my machine" becomes "it works everywhere".
**Why here:** you can start the whole system without installing Python, Node or PostgreSQL yourself.
**Install:** Docker Desktop (Windows/Mac) or Docker Engine (Linux): <https://docs.docker.com/get-docker/>.
**Where in the project:** `backend/Dockerfile`, `frontend/Dockerfile`.

Key words:
* **Image** - the recipe/snapshot (built from a Dockerfile).
* **Container** - a running copy of an image.
* **Volume** - storage that outlives containers (our database files live in one, `pgdata`).

`backend/Dockerfile`, line by line:
```dockerfile
FROM python:3.12-slim          # start from a small Linux image that has Python
WORKDIR /app                   # work inside /app
COPY requirements.txt .        # copy the dependency list first ...
RUN pip install -r requirements.txt   # ... and install it (Docker caches this step until the list changes)
COPY . .                       # then copy the code
USER appuser                   # do not run as root (safer)
CMD ["sh","-c","alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
                               # on start: create/upgrade tables, then run the API
```
`frontend/Dockerfile` is a **multi-stage build**: stage 1 (Node) compiles the React app into plain files; stage 2 (nginx) copies only those files. The final image has no Node in it, so it is small and has less to attack.

Commands:
```bash
docker ps                                # what is running?
docker compose logs -f backend           # live log of the API (Ctrl+C to stop watching)
docker compose exec backend sh           # open a shell inside the backend container
docker system df                         # how much disk Docker uses
```

### Docker Compose
**What:** a way to describe several containers in one file and start them together.
**Where:** `docker-compose.yml` at the project root. It defines three *services*:

| Service | Image | Job |
|---|---|---|
| `db` | `postgres:16-alpine` | the database; data in the `pgdata` volume; has a *healthcheck* |
| `backend` | built from `./backend` | the API; waits until `db` is healthy (`depends_on ... service_healthy`) |
| `frontend` | built from `./frontend` | nginx serving the web app on `WEB_PORT` (default 8080) |

Only `frontend` publishes a port to your machine. The database is **not** reachable from outside, which is deliberate.
Inside the compose network, containers reach each other by service name: the backend connects to `db:5432`, nginx forwards to `backend:8000`.

Values like `${SECRET_KEY:?message}` are read from your `.env` file; the `:?` form stops startup with your message if the value is missing.
```bash
docker compose up -d --build     # build images and start everything in the background
docker compose ps                # status
docker compose logs -f           # all logs
docker compose stop              # stop (data kept)
docker compose down              # remove containers (data kept in the volume)
docker compose down -v           # !!! also DELETES the database volume !!!
docker compose exec backend python -m app.seed      # run a command inside a running service
```

### nginx
**What:** a fast web server / reverse proxy.
**Why here (production only):** it serves the compiled React files and forwards anything starting with `/api/` to the backend. Because the browser only ever talks to one address, there are no cross-origin (CORS) problems.
**Where:** `frontend/nginx.conf`. Points to notice:
* `location /api/ { proxy_pass http://backend:8000; ... Upgrade ... }` - the two `Upgrade`/`Connection` lines are what let **WebSockets** pass through. Without them live updates silently fail.
* `location / { try_files $uri /index.html; }` - React Router handles URLs like `/inventory` in the browser, so any unknown path must return `index.html`.
* `/assets/` files get a 30-day cache because their names contain a content hash.

### PostgreSQL (database)
**What:** a robust open-source relational database. Data lives in **tables** (rows and columns) linked by **foreign keys**.
**Why PostgreSQL and not SQLite/MySQL here:** this app relies on features Postgres does very well: row-level locks (`SELECT ... FOR UPDATE`) so two tills cannot sell the same last item, `INSERT ... ON CONFLICT`, exact `NUMERIC` money types, timezone-aware timestamps and time-zone conversion in SQL.
**Version:** 16 (14+ works).

Connect to it:
```bash
# in Docker
docker compose exec db psql -U vapepos -d vapepos
# local install
psql postgresql://vapepos:vapepos@localhost:5432/vapepos
```
Handy `psql` commands (inside the prompt):
```sql
\dt                                   -- list tables
\d products                           -- describe a table
SELECT name, stock_quantity FROM branch_inventory i JOIN products p ON p.id=i.product_id WHERE i.branch_id=1 LIMIT 10;
\q                                    -- quit
```
Backup and restore (see also DEPLOYMENT.md):
```bash
docker compose exec -T db pg_dump -U vapepos vapepos > backup.sql          # backup
docker compose exec -T db psql -U vapepos vapepos < backup.sql            # restore into an empty DB
```
**Money:** stored as `NUMERIC(10,2)`, never floating point, so 0.1 + 0.2 is exactly 0.3.
**Tables:** see `docs/ARCHITECTURE.md` for the full list and diagram.

---

## 4. Backend

All backend code is in `backend/`. Dependencies are listed in `backend/requirements.txt`.

### Python 3.12 and pip / venv
**What:** the programming language, its package installer (`pip`) and isolated environments (`venv`).
**Why venv:** keeps this project's libraries separate from everything else on your machine.
```bash
cd backend
python -m venv .venv                     # create the environment (once)
source .venv/bin/activate                # Windows PowerShell:  .venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt      # install libraries (+ test tools)
pip list                                 # what is installed
deactivate                               # leave the environment
```
In Docker, none of this is needed; the Dockerfile does it.

### FastAPI (0.141)
**What:** a modern Python web framework for building APIs. You write ordinary Python functions and decorate them with a URL; FastAPI handles parsing, validation, security and documentation.
**Why here:** automatic request validation, automatic interactive docs, first-class WebSocket support, and dependency injection that makes "who is logged in and which branch may they touch" clean and reusable.
**Where:** `app/main.py` (creates the app, mounts routers), `app/routers/*.py` (endpoints).

A real endpoint from the project, annotated:
```python
@router.post("", response_model=SaleOut, status_code=201)      # POST /api/v1/sales -> returns a SaleOut
def create_sale(
    body: SaleCreate,                                           # JSON body, validated by Pydantic
    background: BackgroundTasks,                                # run something after responding
    db: Session = Depends(get_db),                              # a database session for this request
    user: User = Depends(get_current_user),                     # rejects the request if not logged in
):
    branch_id = scope_branch(user, body.branch_id, required=True)   # cashiers: forced to own branch
    ...
```
**Dependencies (`Depends`)** are the key idea. `app/deps.py` defines:
* `get_current_user` - reads the `Authorization: Bearer <token>` header, verifies it, loads the user.
* `require_roles("admin","manager")` - only lets those roles through (else 403).
* `scope_branch(user, requested)` - **the multi-branch security rule**: admins may choose any branch or none (= all); everyone else is locked to their own branch and gets 403 for anything else.

**Interactive docs:** open `/api/v1/docs` (Swagger UI). Click **Authorize**, log in with a demo account, and try any endpoint from the browser. `/api/v1/redoc` is a read-only alternative.

Status codes used: `200/201` OK, `204` OK no body, `400` bad request, `401` not logged in, `403` logged in but not allowed, `404` not found, `409` conflict (e.g. not enough stock, duplicate barcode), `422` validation failed.

### Starlette
FastAPI is built on Starlette. You use it indirectly for WebSockets (`WebSocket`, `WebSocketDisconnect`), CORS middleware and the test client. Nothing to install separately.

### Uvicorn (0.53)
**What:** the ASGI server that actually listens on a port and runs the FastAPI app.
```bash
uvicorn app.main:app --reload              # development: restarts when you save a file
uvicorn app.main:app --host 0.0.0.0 --port 8000   # what Docker runs
```
`app.main:app` means "in file `app/main.py`, the variable named `app`".
**Important:** the live-update feature keeps its list of connected browsers in memory, so run **one** worker (do not add `--workers 4`). One worker easily handles several shops. See ARCHITECTURE.md for how to scale later.

### Pydantic (2.x) and pydantic-settings
**What:** defines data shapes in Python classes and validates them.
**Where:** `app/schemas.py` (API shapes) and `app/config.py` (settings).
```python
class SaleItemIn(BaseModel):
    product_id: int
    quantity: int = Field(gt=0, le=999)      # must be 1..999, otherwise the API answers 422 automatically
```
* `...In` / `...Update` classes = what the API **accepts**. `...Out` classes = what it **returns** (so `password_hash` can never leak).
* `Money` is a custom type: computed as exact `Decimal`, sent to the browser as a normal JSON number.
* Cost price (`buying_price`) is set to `null` in responses to cashiers.

`pydantic-settings` reads configuration from environment variables or a `.env` file into the `Settings` class (`app/config.py`):

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | how to reach PostgreSQL. Neon/Render strings (`postgresql://...`) can be pasted as-is | local `vapepos` database |
| `SECRET_KEY` | signs login tokens; **must** be secret and long | placeholder (app refuses to start in production with it) |
| `ENVIRONMENT` | `development` or `production` | `development` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | how long a login lasts | 720 (12 h) |
| `CORS_ORIGINS` | comma-separated allowed browser origins | `http://localhost:5173` |
| `BUSINESS_TIMEZONE` | timezone that defines a "day" | `UTC` (set yours!) |

### SQLAlchemy (2.0) - the ORM
**What:** an Object-Relational Mapper: you work with Python classes (`Product`, `Sale`) and it writes the SQL.
**Where:** `app/models.py` (table definitions), `app/database.py` (engine + sessions), all routers (queries).
```python
class Product(Base):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(primary_key=True)
    barcode: Mapped[str] = mapped_column(String(100), unique=True)
    selling_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
```
Patterns used in this project:
* **Session per request:** `get_db()` yields a session and closes it afterwards. If an error is raised before `db.commit()`, everything is rolled back automatically.
* **Queries:** `db.scalars(select(Product).where(Product.is_active.is_(True))).all()`.
* **Aggregates for reports:** `func.sum`, `func.count`, `case(...)`, `group_by` (see `routers/reports.py`).
* **Row locking:** `.with_for_update()` in `services/inventory.py`.
* **Constraints in the database, not only in Python:** e.g. `CHECK (stock_quantity >= 0)`, unique `(product_id, branch_id)`, `CHECK (from_branch_id <> to_branch_id)`. Even a bug in the code cannot create negative stock.

### psycopg 3
**What:** the low-level PostgreSQL driver SQLAlchemy uses (`postgresql+psycopg://...` in `DATABASE_URL`). The `[binary]` extra ships pre-built code so you do not need a C compiler.

### Alembic (1.x) - database migrations
**What:** version control for your database *structure*. Each change (new column, new table) is a small script called a migration; Alembic applies them in order and remembers which ones ran (in a table called `alembic_version`).
**Where:** `backend/alembic/` and `backend/alembic.ini`. `alembic/env.py` reads `DATABASE_URL` and your models. The first migration is `alembic/versions/0001_initial_schema.py`.
```bash
alembic upgrade head                              # bring the DB up to date (Docker does this on every start)
alembic current                                   # which version is the DB at?
alembic history                                   # list migrations

# You changed a model (e.g. added Product.supplier) - now generate a migration:
alembic revision --autogenerate -m "add supplier to products"
# ALWAYS open the new file in alembic/versions/ and read it, then:
alembic upgrade head
alembic downgrade -1                              # undo the last migration (dev only)
alembic check                                     # reports if models and DB disagree
```
**Rules of thumb:** never edit a migration that has already been applied on a real server (add a new one instead); commit migration files to Git; take a backup before upgrading production.

### PyJWT and JSON Web Tokens
**What:** creates and verifies login tokens. See [JWT explained](#jwt-json-web-token).
**Where:** `app/security.py` (`create_access_token`, `decode_access_token`).

### bcrypt
**What:** a deliberately *slow* password-hashing algorithm. Passwords are never stored; only a salted hash is (`users.password_hash`). Logging in re-hashes what you typed and compares.
**Where:** `app/security.py`. Limit: bcrypt only reads the first 72 bytes of a password, so the API caps passwords at 72 characters.

### python-multipart
Needed by FastAPI to read the **form-encoded** login request (the standard OAuth2 "password flow" that also makes the Swagger *Authorize* button work). No code of ours touches it.

### tzdata
Timezone database for Python's `zoneinfo`. Slim Docker images do not ship one, so it is a listed dependency. Used by `services/timeutils.py` to decide what "today" means in `BUSINESS_TIMEZONE`.

### pytest and httpx - automated tests
**What:** `pytest` finds and runs test functions; `httpx` powers FastAPI's `TestClient`, which calls the API in-process.
**Where:** `backend/tests/`.
```bash
createdb vapepos_test                 # once (or create it with psql)
cd backend && python -m pytest        # run all 20 tests
python -m pytest -k transfer -v       # only tests with "transfer" in the name, verbose
python -m pytest -x                   # stop at the first failure
```
The tests use a **real PostgreSQL** database (default `vapepos_test`; override with `TEST_DATABASE_URL`) because locking and timezone SQL are Postgres features. They wipe that database's tables between tests, so **never point `TEST_DATABASE_URL` at real data**.

What is covered: login and failure cases; role permissions; cashiers locked to their branch; hidden cost price; sale maths (subtotal, tax, change); stock decrement and ledger; insufficient stock; **two simultaneous sales for the last unit -> exactly one succeeds**; the full transfer lifecycle and who may perform each step; atomic failure of a transfer when source stock disappeared; Z-report totals and cash variance; double-close rejection; dashboard figures; WebSocket delivery to the right branches.

### Seed script
`python -m app.seed` fills an **empty** database with demo data: 4 branches, users, ~40 products, per-branch stock (some intentionally low), 3 weeks of sales, and 2 transfers. `--reset` wipes everything first (development only!); it asks you to type `RESET`, or pass `--yes` to skip the question. For a real system use `python -m app.create_admin` instead of seeding.

---

## 5. Frontend

All frontend code is in `frontend/`. Dependencies are in `frontend/package.json`.

### Node.js (22) and npm
**What:** Node runs JavaScript outside the browser (needed for build tools); `npm` installs JavaScript libraries into `node_modules/`.
**Install:** <https://nodejs.org> (LTS), or `nvm` to manage versions.
```bash
npm install            # download everything listed in package.json (first time / after changes)
npm run dev            # development server with instant reload  -> http://localhost:5173
npm run build          # type-check, then produce the production files in dist/
npm run typecheck      # TypeScript check only
npm install some-lib   # add a library
```
`package-lock.json` pins exact versions; commit it. Docker uses `npm ci`, which installs exactly what the lock file says.

### Vite (8)
**What:** the development server and bundler.
**Why here:** near-instant startup, hot reload (edit a file, see the change without refresh), and a tidy production build.
**Where:** `frontend/vite.config.ts`. It forwards `/api` (including WebSockets) to the backend on port 8000, so the code can use relative URLs in development and production alike. If your backend is elsewhere: `VITE_API_TARGET=http://other-host:8000 npm run dev`.
Settings prefixed `VITE_` (for example `VITE_CURRENCY=EUR`, read in `src/lib/format.ts`) are baked into the app at **build** time.

### TypeScript (7)
**What:** JavaScript plus types. The compiler catches mistakes (a misspelled field, a missing null check) before the code runs.
**Where:** `tsconfig.json` (strict mode on); shapes of API data are in `src/lib/types.ts` and mirror `backend/app/schemas.py`. **If you change a backend schema, update `types.ts` too.**

### React (19)
**What:** a library for building UIs from small reusable *components* (functions that return markup). When data (*state*) changes, React updates the screen.
**Where:** `src/pages/*.tsx` (one component per screen), `src/components/*` (shared pieces).
```tsx
const [qty, setQty] = useState(1)          // state: a value React watches
<button onClick={() => setQty(qty + 1)}>+</button>   // changing it re-renders the component
```
Files ending `.tsx` contain JSX (HTML-looking syntax inside TypeScript).

### React Router (7)
**What:** client-side navigation: changes the visible screen when the URL changes, without reloading the page.
**Where:** routes are declared in `src/App.tsx`; `Layout.tsx` uses `<Outlet/>` to place the current page inside the sidebar/header shell; `<Protected roles={[...]}>` redirects people away from screens their role should not see (a convenience; the API enforces the real rule).

### TanStack Query (React Query 5)
**What:** fetches server data and caches it. It gives every request `isLoading`, errors, refetching, and shared results between screens.
**Why here:** it makes live updates simple: when the WebSocket says "inventory changed", we tell Query to refetch, and every open screen refreshes.
```tsx
const { data, isLoading } = useQuery({
  queryKey: ['inventory', 'list', branchId],           // cache key: change it -> refetch
  queryFn: async () => (await api.get('/inventory', { params: { branch_id: branchId } })).data,
})
const save = useMutation({ mutationFn: ..., onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }) })
```
`invalidateQueries({queryKey:['inventory']})` marks **every** query whose key *starts with* `inventory` as stale. Defaults are set in `src/main.tsx` (data counts as fresh for 15 s).
The map from server events to keys lives in `src/hooks/useRealtime.ts`.

### Zustand (5)
**What:** tiny global-state library. Used for things that are not server data:
* `store/auth.ts` - token + user, saved in `localStorage` (so refreshing does not log you out).
* `store/branch.ts` - the admin's chosen location. `useActiveBranch()` returns the branch every page should use: the admin's choice, or the fixed branch for managers/cashiers.
* `store/live.ts` - is the WebSocket connected? `store/toast.ts` - little notification messages.

### Axios
**What:** an HTTP client. `src/lib/api.ts` creates one instance with `baseURL: '/api/v1'`, an interceptor that adds the `Authorization: Bearer ...` header to every request, and another that logs the user out on a `401`. `errorMessage()` turns API errors into sentences a cashier can read.

### Tailwind CSS (3.4), PostCSS, Autoprefixer
**What:** *utility-first* CSS. Instead of writing CSS files you compose small classes directly on elements.
```tsx
<button className="rounded-ctl bg-currant-600 px-4 py-2 text-sm font-medium text-white hover:bg-currant-700">Save</button>
```
`px-4` = horizontal padding, `text-sm` = small text, `hover:` = only on mouse-over, `lg:` = only on large screens, `sm:grid-cols-2` = two columns from the "sm" width up.
**Where:** design tokens (colors, fonts, radii) are defined once in `tailwind.config.js`:
* `ink` (text, sidebar), `paper` (page background), `line` (borders), `currant` (brand purple), `mint` (live/active accent), `amber` / `brick` / `moss` (warning / error / success tones).
* Fonts: Bricolage Grotesque (headings, big numbers) + IBM Plex Sans (everything else).

`src/index.css` holds the three `@tailwind` lines, a few base rules, the receipt-edge component (`.ticket-edge`) and **print rules**: when printing, only elements with class `print-area` are shown (80 mm wide, for thermal receipt printers), and `.no-print` elements are hidden.
PostCSS is the tool that runs Tailwind; Autoprefixer adds browser-specific CSS prefixes automatically. Both are configured in `postcss.config.js`.
Tailwind only ships classes it finds in your files, so write full class names (`bg-red-500`), never build them from pieces (`"bg-" + color`).

### Recharts (3)
**What:** chart components for React (`LineChart`, `BarChart`, ...). Used only in `pages/Dashboard.tsx`. Data goes in as an array of objects; each `<Line dataKey="...">` picks a field.

### lucide-react
**What:** the icon set (`<ShoppingCart size={18} />`). Import only the icons you use.

### clsx
**What:** builds class-name strings conditionally: `clsx('px-3', active && 'bg-currant-600')`.

### Fontsource
**What:** the fonts are installed as npm packages (`@fontsource/...`) and bundled with the app, so the shop does **not** need internet access to Google Fonts and nothing is loaded from third parties.

### Browser features used directly
* `WebSocket` (in `useRealtime.ts`) - live updates.
* `localStorage` - keeps the login and selected branch.
* `window.print()` - prints the receipt and the Z-Report.
* A **USB/Bluetooth barcode scanner** acts as a keyboard: it "types" the barcode and presses Enter. The POS search box handles exactly that: an Enter with an exact barcode adds the product.

---

## 6. Key ideas

### JWT (JSON Web Token)
1. You send username + password to `POST /api/v1/auth/login`.
2. The backend checks the bcrypt hash and replies with a **token**: a signed string that says "user 7, role cashier, expires at ...".
3. The frontend stores it and sends `Authorization: Bearer <token>` with every request.
4. The backend verifies the signature (using `SECRET_KEY`) and loads the user **from the database on every request**, so disabling an account takes effect immediately.
If `SECRET_KEY` leaks, anyone can forge tokens: rotate it (all users must log in again). Tokens live 12 hours by default.

### WebSockets (live sync)
A normal request is "ask, get an answer, done". A WebSocket stays open so the server can **push** messages.
1. After login the app opens `wss://.../api/v1/ws?token=...` (`src/hooks/useRealtime.ts`).
2. When something changes, a router queues `manager.publish("inventory.changed", [branch_id], ...)` (`app/realtime.py`).
3. The server sends a tiny JSON message to every connected client allowed to see that branch (admins get everything).
4. The frontend maps the message type to React Query keys and refetches. The message carries no business data, only "something changed", so nothing sensitive is pushed.
5. The client pings every 25 s to keep proxies from closing an idle socket, and reconnects with backoff if the connection drops (then refetches everything it may have missed).
The green **Live** dot in the header shows the state.

### Row locking (why you cannot oversell)
Two cashiers scan the last vape pen at the same instant. Without protection both would read "1 in stock" and both would sell it.
`services/inventory.py::lock_inventory_rows` runs `SELECT ... FOR UPDATE` on the stock rows (always in the same order, to avoid deadlocks). The second cashier's request **waits** until the first commits, then sees `0` and gets a clear `409 Not enough stock`. The test `test_last_unit_cannot_be_sold_twice` proves it.
The same locking makes the transfer "receive" step atomic: either all stock moves or nothing does.

### Migrations vs. seeding
* **Migrations** (Alembic) create/alter the *structure*. Run on every deployment.
* **Seed** creates *demo data*. Run once, on a fresh database, only for demos.

### Business timezone
A sale at 11:30 pm New York time is already "tomorrow" in UTC. Reports and the Z-Report therefore group sales by the calendar day in `BUSINESS_TIMEZONE`, computed in the database. The browser never decides what "today" is; the server does.

---

## 7. Follow one sale

A cashier at *Riverside* scans a Mango Ice e-liquid and taps **Charge**:

1. **Browser / React (`Pos.tsx`)** - the scan arrives as keystrokes ending in Enter; the product is added to the cart (state in `useState`). Totals are shown with cent-exact integer maths.
2. **Axios (`lib/api.ts`)** - `POST /api/v1/sales` with the cart. The interceptor adds the JWT.
3. **Vite proxy (dev) / nginx (prod)** - forwards `/api/...` to the backend.
4. **Uvicorn -> FastAPI** - routes the request to `create_sale`.
5. **Dependencies** - `get_current_user` decodes the JWT (PyJWT) and loads the cashier; `scope_branch` forces the branch to Riverside no matter what the request says.
6. **Pydantic** - validates the body (quantities 1-999, payment method `cash|card`).
7. **SQLAlchemy + psycopg + PostgreSQL** - locks the stock rows, checks stock, computes subtotal/tax/total with `Decimal`, inserts `sales` and `sale_items`, decrements `branch_inventory`, appends `stock_movements`, commits - all in one transaction.
8. **BackgroundTasks + WebSocket manager** - after the response is sent, publishes `sale.created` and `inventory.changed` for Riverside.
9. **Browsers everywhere** - the Riverside manager's dashboard and the admin's dashboard receive the message, React Query refetches, numbers update. Other branches' cashiers receive nothing.
10. **Browser (`Receipt.tsx`)** - the response includes the branch's header/footer text; the receipt modal appears; **Print** uses `window.print()` and the print CSS.

---

## 8. Cheat sheet

| I want to... | Command |
|---|---|
| Start everything (Docker) | `docker compose up -d --build` |
| Stop everything | `docker compose stop` |
| See backend logs | `docker compose logs -f backend` |
| Load demo data | `docker compose exec backend python -m app.seed` |
| Wipe and reload demo data | `docker compose exec backend python -m app.seed --reset --yes` |
| Create your own admin | `docker compose exec backend python -m app.create_admin` |
| Open a database shell | `docker compose exec db psql -U vapepos vapepos` |
| Back up the database | `docker compose exec -T db pg_dump -U vapepos vapepos > backup.sql` |
| Update after changing code | `docker compose up -d --build` |
| Run backend tests | `cd backend && python -m pytest` |
| Start backend (dev) | `cd backend && uvicorn app.main:app --reload` |
| Start frontend (dev) | `cd frontend && npm run dev` |
| Build frontend | `cd frontend && npm run build` |
| New migration after editing models | `cd backend && alembic revision --autogenerate -m "message"` |
| Apply migrations | `cd backend && alembic upgrade head` |
| API docs | `http://localhost:8080/api/v1/docs` (Docker) or `:8000/api/v1/docs` (dev) |

---

## 9. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `docker compose up` says *Set SECRET_KEY in .env* | You have not created `.env`. `cp .env.example .env` and fill in the blanks. |
| Backend restarts in a loop, log says *SECRET_KEY must be changed* | `ENVIRONMENT=production` with the placeholder key. Set a real `SECRET_KEY`. |
| `password authentication failed` after changing `POSTGRES_PASSWORD` | The password is only applied when the volume is first created. Either change it inside Postgres (`ALTER USER`), or `docker compose down -v` (**deletes data**) and start again. |
| Login page says *Cannot reach the server* | Backend not running / still starting. `docker compose logs backend`. In dev, is `uvicorn` running on port 8000? |
| "Live" indicator stays orange | WebSocket blocked. Behind your own proxy, make sure it forwards `Upgrade`/`Connection` headers (see nginx section). |
| Reports show "yesterday's" sales as today, or an end-of-day is off by a day | `BUSINESS_TIMEZONE` is not set to your shop's timezone. |
| `relation "users" does not exist` | Migrations have not run. `alembic upgrade head`. |
| Tests fail with connection refused | PostgreSQL not running, or `vapepos_test` database missing. |
| Blank page after deploying frontend behind a sub-path | The app expects to be served from `/`. Use a (sub)domain instead of a sub-path. |
| Port 8080 already in use | Set `WEB_PORT=8081` (any free port) in `.env`. |
| Changed frontend code but the browser shows the old version | Hard refresh (`Ctrl+Shift+R`); in Docker, rebuild: `docker compose up -d --build frontend`. |
| A manager sees "You can only access your own branch" | Working as designed. Only admins can look at other branches. |
