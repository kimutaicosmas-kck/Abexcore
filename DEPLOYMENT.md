# AbexCore ERP — Production Go-Live Runbook

Use this checklist when deploying AbexCore ERP v2.1 to staging or production.

---

## 1. Pre-flight (before deploy)

| Step | Action |
|------|--------|
| ☐ | Server: Ubuntu 22.04+ or Docker host with 4 GB+ RAM |
| ☐ | Install Docker Engine + Docker Compose v2 |
| ☐ | DNS A record pointed to server (if using a domain) |
| ☐ | TLS certificate ready (Let's Encrypt / commercial) |
| ☐ | MySQL backup strategy defined (daily `mysqldump` or volume snapshots) |

---

## 2. Environment variables

Create a `.env` file in the project root (or set in your orchestrator):

```env
JWT_SECRET=<random-64-char-string>
JWT_REFRESH_SECRET=<different-random-64-char-string>
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=notifications@yourcompany.co.ke
SMTP_PASS=<app-password>
SMTP_FROM="AbexCore ERP <notifications@abexcore.com>"
```

**Never use default Docker Compose JWT placeholders in production.**

Generate secrets (PowerShell):

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

---

## 3. Docker deployment (recommended)

```bash
# From project root
docker compose build
docker compose up -d

# Wait for MySQL health (~30s), then verify backend
curl http://localhost:3001/api/health
```

Expected health response:

```json
{ "status": "ok", "version": "2.1.0", "database": "connected" }
```

### First-time database setup

Migrations run automatically on backend startup (`prisma migrate deploy`).  
Apply locally with:

```bash
cd backend
npx prisma migrate deploy
```

**Seed is not automatic** — choose one:

```bash
# Demo data (development)
docker compose exec backend npm run db:seed

# Production (roles + admin only, no demo transactions)
SEED_ADMIN_PASSWORD='YourStrongPass1' docker compose exec backend npm run db:seed:production
```

### Default admin (change immediately after login)

```
Email:    admin@filtererp.co.ke
Password: Admin@123
```

---

## 4. Manual deployment (without Docker)

```bash
# Backend
cd backend
cp .env.example .env          # edit DATABASE_URL, JWT secrets
npm ci
npx prisma generate
npx prisma migrate deploy
npm run db:seed               # first time only
npm run build
NODE_ENV=production node dist/index.js

# Frontend (separate terminal)
cd frontend
npm ci
npm run build
# Serve dist/ via Nginx — proxy /api to backend:3001
```

---

## 5. Post-deploy smoke test

Run through this list in the browser (http://localhost or your domain):

| # | Test | Pass |
|---|------|------|
| 1 | Login with admin credentials | ☐ |
| 2 | Dashboard loads KPIs and charts | ☐ |
| 3 | Users → list loads, stats visible | ☐ |
| 4 | CRM → customers tab, search works | ☐ |
| 5 | Products → create/list | ☐ |
| 6 | Sales → quotation → convert to order | ☐ |
| 7 | Delivery → create delivery note | ☐ |
| 8 | Finance → invoices list, export PDF | ☐ |
| 9 | Reports → financial statements panel | ☐ |
| 10 | Settings → save company profile | ☐ |
| 11 | Logout and re-login | ☐ |

### API smoke test (optional)

```bash
cd backend
npm test
```

All test files should pass when `DATABASE_URL` points to a seeded database.

---

## 6. Security hardening (production)

| Item | Action |
|------|--------|
| Admin password | Force change on first login |
| JWT secrets | Unique per environment; rotate if compromised |
| HTTPS | Terminate TLS at Nginx/reverse proxy; redirect HTTP → HTTPS |
| `FRONTEND_URL` | Set to production URL in backend env |
| Rate limiting | Already enabled; tune in backend if needed |
| Uploads | `uploads/` volume backed up; scan if accepting external files |
| Firewall | Expose only 443 (and 80 redirect); block direct 3306 publicly |

---

## 7. Nginx + HTTPS (bare metal)

Example server block (after obtaining certs via Certbot):

```nginx
server {
    listen 443 ssl http2;
    server_name erp.yourcompany.co.ke;

    ssl_certificate     /etc/letsencrypt/live/erp.yourcompany.co.ke/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/erp.yourcompany.co.ke/privkey.pem;

    root /var/www/erp/frontend/dist;
    index index.html;

    location / { try_files $uri $uri/ /index.html; }

    location /api {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 50M;
    }

    location /uploads {
        proxy_pass http://127.0.0.1:3001/uploads;
    }
}
```

---

## 8. Backup & restore

### Automated backups on the VPS (recommended)

After deploy, SSH into Contabo and run once:

```bash
cd ~/Abexcore
git pull origin main
chmod +x scripts/server-backup.sh scripts/server-restore.sh scripts/install-backup-cron.sh
./scripts/install-backup-cron.sh
./scripts/server-backup.sh    # test immediately
```

This installs a **daily cron job at 02:00** (server local time) that backs up:

| Item | File |
|------|------|
| MySQL database | `~/Abexcore-backups/YYYY-MM-DD/database.sql.gz` |
| Uploaded files (logos, avatars, products) | `uploads.tar.gz` |
| Generated reports | `reports.tar.gz` |
| Single download bundle | `~/Abexcore-backups/abexcore_backup_YYYYMMDD_HHMMSS.tar.gz` |

Backups older than **14 days** are removed automatically (`RETAIN_DAYS=14`).

**Important:** Copy the `.tar.gz` bundle off the server regularly (Google Drive, another PC, Contabo snapshot, etc.). Backups on the same disk do not protect against server failure.

Logs: `/var/log/abexcore-backup.log`

### Manual backup (quick)

```bash
cd ~/Abexcore
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env exec -T mysql \
  sh -c 'mysqldump -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction "$MYSQL_DATABASE"' \
  | gzip > ~/erp_backup_$(date +%F).sql.gz
```

Or use `./scripts/server-backup.sh` for database + uploads + reports.

### Restore from server backup

```bash
cd ~/Abexcore
./scripts/server-restore.sh ~/Abexcore-backups/2026-08-14
# or from bundle:
./scripts/server-restore.sh ~/Abexcore-backups/abexcore_backup_20260814_020001.tar.gz
```

Type `RESTORE` when prompted. Take a fresh backup before restoring.

### Legacy / CI backup scripts

`scripts/backup-mysql.sh` + `DATABASE_URL` — for local dev or GitHub Actions (`BACKUP_DATABASE_URL` secret).

```bash
docker compose exec -T mysql mysql -u erp_user -p"$MYSQL_PASSWORD" filter_erp < backup_2026-07-14.sql
```

---

## 9. Updates & rollback

```bash
git pull
docker compose build
docker compose up -d
# Migrations apply automatically on backend restart
```

Rollback: redeploy previous image tag / git tag and restore DB backup if schema changed.

---

## 10. Monitoring

| Check | URL / command |
|-------|----------------|
| API health | `GET /api/health` |
| Backend logs | `docker compose logs -f backend` |
| MySQL logs | `docker compose logs -f mysql` |
| Disk space | `df -h` (uploads + reports volumes grow over time) |

---

## 11. Support contacts

| Role | Contact |
|------|---------|
| System admin | _your IT contact_ |
| AbexCore support | _your vendor contact_ |

---

## 12. Free hosting (2-week testing)

Use this for a short UAT/staging window without paying for a VPS.

### Recommended: Railway (all-in-one, ~2 weeks on trial credit)

| Component | Railway service |
|-----------|-----------------|
| MySQL | **Add MySQL** template |
| API | **Deploy from GitHub** → root `backend/` |
| Web UI | **Static site** or Vercel/Netlify → root `frontend/` |

**Steps**

1. Push the repo to **GitHub** (if not already).
2. Sign up at [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**.
3. **MySQL**
   - Add service → **Database** → **MySQL**
   - Copy the `MYSQL_URL` / connection string.
4. **Backend** (`backend/` folder)
   - New service → same repo → set **Root Directory** to `backend`
   - Variables:

     ```env
     DATABASE_URL=<paste MySQL URL — use mysql:// not mysql2://>
     NODE_ENV=production
     JWT_SECRET=<64-char random>
     JWT_REFRESH_SECRET=<64-char random>
     FRONTEND_URL=https://<your-frontend-url>
     SEED_ON_START=true
     MPESA_ENV=stub
     ```

   - Deploy; open `https://<backend-url>/api/health` → `"database":"connected"`
5. **Frontend** (Vercel — free, no cold starts)
   - [vercel.com](https://vercel.com) → Import GitHub repo → **Root Directory** `frontend`
   - Build env:

     ```env
     VITE_API_URL=https://<backend-url>/api/v1
     ```

   - Deploy; set `FRONTEND_URL` on the backend to the Vercel URL.
6. Login: `admin@filtererp.co.ke` / `Admin@123` — change password after first login.

**Cost:** Railway trial credits (~$5); Vercel hobby tier is free. Enough for ~2 weeks of light testing.

---

### Alternative: Render (free API + static) + Railway MySQL

1. Railway: create **MySQL only**; copy `DATABASE_URL`.
2. [render.com](https://render.com) → **Blueprint** → connect repo → uses root `render.yaml`.
3. Set manual env vars in Render dashboard:
   - `erp-api` → `DATABASE_URL`, `FRONTEND_URL`
   - `erp-web` → `VITE_API_URL=https://<erp-api-host>/api/v1`
4. **Note:** Render free web services **sleep after ~15 min idle** (first load may take 30–60s).

---

### Alternative: Oracle Cloud Always Free (full control, no sleep)

- Create an **Ampere A1** VM (Ubuntu 22.04, 4 GB RAM).
- Install Docker; clone repo; `docker compose up -d`.
- Open ports 80/443 in security list; point a domain or use the public IP.
- Stays free beyond 2 weeks if you stay within Always Free limits.

---

### Post-deploy checklist (any platform)

| ☐ | `GET /api/health` returns `database: connected` |
| ☐ | Frontend loads and login works |
| ☐ | `FRONTEND_URL` matches the real web URL (CORS) |
| ☐ | `VITE_API_URL` set before frontend build (split deploy) |
| ☐ | Change default admin password |
| ☐ | Export a DB backup before the trial ends |

---

**Document version:** 1.1 — AbexCore ERP v2.1.0
