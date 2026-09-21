# Deployment guide

Goal: run VapePOS on one small Linux server, reachable over HTTPS, with backups.
A VPS with **1-2 vCPU, 2 GB RAM, 20 GB disk** is plenty for four shops.

## 1. Prepare the server

Ubuntu 22.04 or 24.04 is assumed. Run these as root (or prefix with `sudo`).

```bash
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh            # installs Docker Engine + the Compose plugin
adduser deploy && usermod -aG docker deploy       # a normal user that may run Docker
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

Point a DNS **A record** (for example `pos.yourshop.com`) at the server's IP address.

## 2. Get the code and configure

```bash
su - deploy
git clone <your-repo-url> vape-pos && cd vape-pos     # or upload the project folder / unzip it here
cp .env.example .env
nano .env
```

Fill in:

```
POSTGRES_PASSWORD=<output of: openssl rand -hex 16>
SECRET_KEY=<output of: openssl rand -hex 32>
BUSINESS_TIMEZONE=America/New_York          # YOUR shops' timezone
WEB_PORT=8080
CORS_ORIGINS=https://pos.yourshop.com
```

`ENVIRONMENT` defaults to `production` in `docker-compose.yml`, which makes the API refuse to start with a placeholder secret.

Bind the app to the local machine only, so the outside world reaches it exclusively through HTTPS.
In `docker-compose.yml`, change the frontend port line to:

```yaml
    ports:
      - "127.0.0.1:${WEB_PORT:-8080}:80"
```

Start it:

```bash
chmod 600 .env
docker compose up -d --build
docker compose ps                              # all three services should be running
curl http://localhost:8080/api/v1/health       # {"status":"ok"}
```

## 3. Create your first admin

Do **not** load the demo seed on a real system: it creates well-known passwords.
Create your own admin instead (it asks for a username and password):

```bash
docker compose exec backend python -m app.create_admin
```

Sign in, then create branches (**Branches**), products (**Products**) and staff (**Staff**) in the app.

If you tried the demo data first, wipe it before going live: `docker compose exec backend python -m app.seed --reset --yes`
removes everything (then create your admin again), or run `docker compose down -v` to delete the database volume and start clean.

## 4. HTTPS with Caddy (simplest)

Caddy obtains and renews free certificates automatically and passes WebSockets through without extra settings.

```bash
apt install -y caddy
nano /etc/caddy/Caddyfile
```

Put this in the file (replace the domain):

```
pos.yourshop.com {
    encode gzip
    reverse_proxy 127.0.0.1:8080
}
```

```bash
systemctl reload caddy
```

Open `https://pos.yourshop.com`.

Alternative: nginx + certbot. Keep the same `Upgrade` / `Connection` header lines that are in `frontend/nginx.conf`, otherwise the live-update WebSocket will not connect.

## 5. Backups (do this on day one)

The database *is* the business. Create `/home/deploy/backup.sh`:

```bash
#!/bin/sh
set -e
cd /home/deploy/vape-pos
mkdir -p /home/deploy/backups
docker compose exec -T db pg_dump -U vapepos vapepos | gzip > /home/deploy/backups/vapepos-$(date +%F-%H%M).sql.gz
find /home/deploy/backups -name 'vapepos-*.sql.gz' -mtime +30 -delete      # keep 30 days
```

Make it executable and schedule it nightly:

```bash
chmod +x /home/deploy/backup.sh
crontab -e
# add this line (every night at 03:15):
15 3 * * *  /home/deploy/backup.sh
```

Also copy the backups **off the server** (another machine, or S3 / Backblaze using `rclone`, or your provider's snapshots).
A backup that lives on the same disk does not survive a dead disk.

**Test a restore once** (ideally on a spare machine, never on your live server by surprise):

```bash
docker compose stop backend
docker compose exec -T db psql -U vapepos -d postgres -c "DROP DATABASE IF EXISTS vapepos" -c "CREATE DATABASE vapepos"
gunzip -c backups/vapepos-XXXX.sql.gz | docker compose exec -T db psql -U vapepos vapepos
docker compose start backend
```

## 6. Updating

```bash
cd ~/vape-pos
/home/deploy/backup.sh            # backup first
git pull                          # or upload/unzip the new version
docker compose up -d --build      # rebuilds; the backend runs "alembic upgrade head" when it starts
docker compose logs --tail 50 backend
```

Migrations run automatically when the backend starts.
To go back to an older version, the safe route is: stop the app, restore the backup taken before the update, check out the older code, rebuild.

## 7. Monitoring

* `GET /api/v1/health` checks the API **and** the database connection. Point a free uptime monitor (UptimeRobot, Better Stack, ...) at `https://pos.yourshop.com/api/v1/health`.
* `docker compose logs -f backend` shows errors; `docker compose ps` shows restarts.
* Every service has `restart: unless-stopped`, so they come back after a server reboot.
* Watch disk space: `df -h` and `docker system df`.

## 8. Security checklist

- [ ] `.env` is not in Git and only you can read it (`chmod 600 .env`)
- [ ] Strong, unique `SECRET_KEY` and `POSTGRES_PASSWORD`
- [ ] No demo accounts exist (`admin/admin1234`, `manager1/manager1234`, ...)
- [ ] Only ports 22, 80 and 443 are open; the database port is not published
- [ ] SSH uses keys only (`PasswordAuthentication no`); consider `fail2ban`
- [ ] HTTPS everywhere; plain HTTP is not exposed to the internet
- [ ] Nightly backups are copied off the server, and a restore has been tested
- [ ] Each person has their own account. When someone leaves, open **Staff -> Edit** and untick "Account can sign in" (takes effect immediately)
- [ ] Server updates are applied regularly (`unattended-upgrades`)
- [ ] Shop tablets and computers are locked down; staff sign out at the end of a shift

## 9. Sizing and scaling

One small server comfortably serves four shops (dozens of tills). If you outgrow it:

1. Move PostgreSQL to a managed database: change `DATABASE_URL`, remove the `db` service.
2. Only then consider more than one API worker, and first replace the in-memory WebSocket broadcaster (see ARCHITECTURE.md, section 6).

## 10. Running without Docker (optional)

Install Python 3.12, PostgreSQL 14+ and Node 22, then:

1. Create the database and user.
2. `cd backend && pip install -r requirements.txt && alembic upgrade head`
3. Run Uvicorn under `systemd` with the variables from `.env`, exactly **one** worker:
   `uvicorn app.main:app --host 127.0.0.1 --port 8000`
4. `cd frontend && npm ci && npm run build`
5. Serve `frontend/dist` with nginx, using `frontend/nginx.conf` as the template (change `proxy_pass http://backend:8000` to `http://127.0.0.1:8000`).
