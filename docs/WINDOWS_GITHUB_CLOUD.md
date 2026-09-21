# Windows setup, GitHub, and hosting on Neon + Vercel

This guide is for **Windows + PowerShell + PyCharm**. It covers:

1. [Run the app on your PC (with a free Neon database, no PostgreSQL install)](#1-run-it-on-your-pc)
2. [Push the project to GitHub](#2-push-to-github)
3. [Host it: Neon (database) + Vercel (website and API)](#3-host-it-on-neon--vercel)
4. [Option B: Vercel website + a normal server for the API (full live sync)](#4-option-b-api-on-render-instead-of-vercel)
5. [Troubleshooting](#5-troubleshooting)

> **Honest note.** Sections 1 and 2 were tested. The Neon and Vercel steps in sections 3 and 4 follow those
> services' current documentation, and the app was tested in exactly the split-hosting layout they need
> (API on one address, website on another, with and without WebSockets), but I could not deploy to *your*
> accounts. If a screen in Vercel or Neon looks different from what is described, trust their screen and
> the build/function logs, which will name the problem.

---

## What went wrong in your first attempt (read once)

| Message | Cause | Fix |
|---|---|---|
| `No module named 'app'` | `python -m app.seed` was run from the project root. `app` lives inside the **backend** folder. | `cd backend` first (in PyCharm: Run configuration -> *Working directory* = the `backend` folder) |
| `Cannot find path '...\.env.example'` | The `cp .env.example .env` line belongs to the *Docker* route and needs the folder that contains `docker-compose.yml`. Your folder probably has one more level (`vape-pos\`) after unzipping. | Run `dir -Force` and look for `backend`, `frontend`, `docker-compose.yml`. `cd` into the folder that shows them. |
| `The token '&&' is not a valid statement separator` | Windows PowerShell 5 does not understand `&&`. | Type commands **one per line** (or separate with `;`). |
| `source : ... not recognized` | `source .venv/bin/activate` is Linux/Mac. | Windows: `.venv\Scripts\Activate.ps1`. PyCharm already activates it for you (you see `(.venv)`). |
| A whole block pasted at once ran in the wrong order | Comments (`# ...`) and multiple steps were pasted together. | Copy **one command at a time**. |

---

## 1. Run it on your PC

You need: **Python 3.12+** (your PyCharm `.venv` is fine), **Node.js LTS** (<https://nodejs.org>, install, then reopen PyCharm), and a free **Neon** account for the database.

### 1.1 Check you are in the right folder

Open the PyCharm **Terminal** (bottom of the window):

```powershell
cd E:\pycharm\VapePOS
dir
```

You must see **`backend`**, **`frontend`** and `docker-compose.yml` in that list.
If instead you see a single folder called `vape-pos`, go into it (`cd vape-pos`). From now on that folder is the **project root**.

### 1.2 Create the database on Neon (2 minutes)

1. Go to <https://neon.com>, sign up, **Create project** (any name, e.g. `vapepos`; pick the region nearest you).
2. On the project dashboard click **Connect**. You will see a connection string. There is a **Connection pooling** switch:
   * switch **OFF** -> copy that string. This is the **direct** string (host looks like `ep-xxxx.region.aws.neon.tech`). Use it on your PC, for migrations and seeding.
   * switch **ON** -> copy that string. This is the **pooled** string (host contains `-pooler`). Use it for the API on Vercel (section 3).
3. Paste them somewhere private for now. They contain your password. Never put them in Git.

### 1.3 Backend

```powershell
cd backend
pip install -r requirements-dev.txt
Copy-Item .env.example .env
notepad .env
```

In Notepad set (paste your **direct** Neon string as-is; the `postgresql://` form is fine):

```
ENVIRONMENT=development
DATABASE_URL=postgresql://neondb_owner:YOUR-PASSWORD@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
SECRET_KEY=type-any-long-random-text-here
CORS_ORIGINS=http://localhost:5173
BUSINESS_TIMEZONE=Asia/Karachi
```

`BUSINESS_TIMEZONE` decides what "today" means for reports. Use your own IANA name (for example `Asia/Karachi`, `Asia/Dubai`, `Europe/London`, `America/New_York`).

Create the tables, add data, start the API - **one line at a time**:

```powershell
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload
```

* `python -m app.seed` fills **demo data** (4 branches, products, sales). Skip it if you want an empty system, and instead run `python -m app.create_admin` to create your own admin.
* Leave this terminal running. Open <http://localhost:8000/api/v1/docs> to check the API.

### 1.4 Frontend (a second terminal)

PyCharm: click the **+** next to the terminal tab to open a new one.

```powershell
cd E:\pycharm\VapePOS\frontend
npm install
npm run dev
```

Open <http://localhost:5173> and sign in: `admin` / `admin1234` (demo data only).

### 1.5 PyCharm tips

* To run something from PyCharm's Run button instead of the terminal: *Run -> Edit Configurations -> Working directory* = `...\backend`. Module name `app.seed`, or `uvicorn` with parameters `app.main:app --reload`.
* Make sure the interpreter is your `.venv` (bottom-right corner of PyCharm).
* Do **not** run `python -m pytest` with a Neon `DATABASE_URL`. The tests **erase** their database. They now refuse to run unless the database name contains `test`. To run tests you would create a second Neon database called e.g. `vapepos_test` and set `TEST_DATABASE_URL`.

### 1.6 Docker route on Windows (optional)

If you prefer the all-in-one Docker route from the README, install Docker Desktop, then in PowerShell, in the project root:

```powershell
Copy-Item .env.example .env
notepad .env
docker compose up -d --build
docker compose exec backend python -m app.create_admin
```

---

## 2. Push to GitHub

1. Create an account at <https://github.com>, then **New repository**. Name it `vapepos`, choose **Private**, and do **not** tick "Add README" (keep it empty). Copy the repository address it shows (`https://github.com/YOUR-NAME/vapepos.git`).
2. In PowerShell, in the **project root** (the folder with `backend` and `frontend`):

```powershell
git init
git add .
git status
```

**Look at the list `git status` prints.** You must **not** see `.env`, `.venv`, or `node_modules`. (`.env.example` is fine and expected.) If you do see them, stop and tell me; do not continue.

```powershell
git commit -m "VapePOS first version"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/vapepos.git
git push -u origin main
```

* If Git says *"Please tell me who you are"*: run `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"`, then repeat the commit.
* On the first push a browser window opens to log in to GitHub. Approve it.
* Warnings like `LF will be replaced by CRLF` are harmless.
* Later changes: `git add .`, `git commit -m "what I changed"`, `git push`.

Passwords and connection strings live only in `.env` files and in Vercel's settings. They are ignored by Git on purpose.

---

## 3. Host it on Neon + Vercel

Layout:

```
 Browser  ->  Vercel project 1: "vapepos-web"   (React app, from the frontend folder)
    |
    +------>  Vercel project 2: "vapepos-api"   (FastAPI, from the backend folder)  ->  Neon PostgreSQL
```

Both projects come from the **same GitHub repository**; you just tell Vercel which folder each one uses.

**What to expect on Vercel:** the API runs as serverless functions. That works well, with two differences from the Docker/server route:

* **No instant push updates.** The screens refresh themselves every 10 seconds instead (the header shows *Auto-refresh*). We turn this on with `VITE_REALTIME=poll`. For instant sync use Option B (section 4).
* **Cold starts.** After a quiet period the first request can take a few seconds.

Also: Vercel's free **Hobby** plan is meant for personal, non-commercial use, and Neon's free plan has limits. Fine for trying it; check both companies' current terms and prices before running a real shop on it.

### 3.1 Create the tables in Neon (from your PC, once)

Vercel does not run migrations. From `backend` on your PC, with `.env` holding the **direct** Neon string (as in 1.3):

```powershell
cd E:\pycharm\VapePOS\backend
alembic upgrade head
python -m app.create_admin
```

Do this again whenever a new version of the app adds a database migration.
(Do **not** use the pooled string for migrations or seeding.)

### 3.2 API project on Vercel

1. <https://vercel.com> -> sign up with GitHub -> **Add New... -> Project** -> import `vapepos`.
2. **Root Directory:** click *Edit* and choose **`backend`**. Framework preset should say **FastAPI**. (Vercel finds `app/main.py` by itself.)
3. **Environment Variables** (add each):

| Name | Value |
|---|---|
| `DATABASE_URL` | the **pooled** Neon string (host contains `-pooler`) |
| `SECRET_KEY` | a long random string (generate one with the command below the table) |
| `ENVIRONMENT` | `production` |
| `BUSINESS_TIMEZONE` | your IANA timezone |
| `CORS_ORIGINS` | `http://localhost:5173` for now (we change it in 3.4) |

Generate a random `SECRET_KEY` in PowerShell (the `(.venv)` one is fine):

```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

4. **Deploy.** When it finishes, open `https://YOUR-API-NAME.vercel.app/api/v1/health`. You should see `{"status":"ok"}`. If not, open the project's **Logs** tab; the error is there.

### 3.3 Website project on Vercel

1. **Add New... -> Project** -> import the **same** repository again.
2. **Root Directory:** `frontend`. Framework preset: **Vite** (automatic).
3. **Environment Variables:**

| Name | Value |
|---|---|
| `VITE_API_URL` | `https://YOUR-API-NAME.vercel.app` (no slash at the end) |
| `VITE_REALTIME` | `poll` |
| `VITE_CURRENCY` | e.g. `PKR`, `USD`, `EUR` (optional) |

4. **Deploy.** You get an address like `https://vapepos-web.vercel.app`.

### 3.4 Let the website talk to the API (CORS)

Back in the **API** project: *Settings -> Environment Variables* -> change `CORS_ORIGINS` to the website address, exactly, with no slash at the end:

```
https://vapepos-web.vercel.app
```

(Several addresses can be separated by commas.) Then *Deployments -> ... -> Redeploy* so the change is picked up.

Open the website, sign in with the admin you created. Done.

**When you change code:** `git add .`, `git commit`, `git push`. Vercel redeploys both projects automatically.

---

## 4. Option B: API on Render instead of Vercel

Choose this if you want **instant** live sync between shops (WebSockets), because a normal always-on server keeps one process that all shops connect to. Keep Neon for the database and Vercel for the website.

1. <https://render.com> -> **New -> Web Service** -> connect the GitHub repo.
2. Settings: **Root Directory** `backend`; **Build Command** `pip install -r requirements.txt`; **Start Command** `uvicorn app.main:app --host 0.0.0.0 --port $PORT` (keep it to one worker).
3. Environment variables as in the table in 3.2, but `DATABASE_URL` can be the **direct** Neon string (a long-running server does not need the pooler). If the build complains about the Python version, add `PYTHON_VERSION` = `3.12.3`.
4. Deploy; check `https://YOUR-SERVICE.onrender.com/api/v1/health`.
5. In the Vercel **website** project set `VITE_API_URL` to the Render address and **delete** `VITE_REALTIME` (so WebSockets are used). Redeploy the website.
6. Set the API's `CORS_ORIGINS` to the website address.

Render's free web services go to sleep when idle and take a while to wake up, which is unpleasant for a till. For real use pick a paid instance, or use a small VPS with the Docker route from `docs/DEPLOYMENT.md`. Check current prices.

---

## 5. Troubleshooting

| Problem | Fix |
|---|---|
| Website shows *Cannot reach the server* | `VITE_API_URL` wrong or missing (rebuild after changing it: *Redeploy*), or the API project failed - open `.../api/v1/health`. |
| Browser console: *blocked by CORS policy* | `CORS_ORIGINS` on the API must equal the website address exactly (`https://...`, no trailing slash). Redeploy the API after changing it. |
| API build fails on Vercel | Root Directory must be `backend`. Open the build log; the missing package or wrong Python version is named there. |
| API error `relation "users" does not exist` | You have not run `alembic upgrade head` against Neon (3.1). |
| `password authentication failed` | The password in `DATABASE_URL` is wrong or contains special characters. Copy the string again from Neon's **Connect** dialog. |
| `prepared statement ... does not exist` / pooler errors while migrating or seeding | You used the **pooled** string. Use the **direct** one for `alembic` and `seed`. |
| First request after a while is slow or times out once | Neon scales idle databases to zero and Vercel cold-starts functions. Refresh; consider paid plans or an always-on server for a live shop. |
| `PowerShell: running scripts is disabled` when activating a venv | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or just use PyCharm's terminal which activates it for you. |
| `alembic` or `uvicorn` "not recognized" | The `.venv` is not active or `pip install -r requirements-dev.txt` was not run. Check for `(.venv)` at the start of the prompt. |
| I accidentally committed `.env` | Change every password/secret in it (Neon password: *Roles* -> reset; new `SECRET_KEY`), then remove it from Git: `git rm --cached backend/.env`, commit, push. Old commits still contain it, so rotating the secrets is what matters. |
