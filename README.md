# AbexCore ERP v2.1 — Designed by AbexCore Technologies

Enterprise-grade, **multi-tenant** ERP for manufacturing and distribution. Manages the full business lifecycle from raw-material procurement through production, inventory, sales, delivery, finance, CRM, HR, quality, and maintenance.

**Live production:** [https://abexcore.co.ke](https://abexcore.co.ke)  
**Product version:** `2.1.0`  
**Repository:** [kimutaicosmas-kck/Abexcore](https://github.com/kimutaicosmas-kck/Abexcore)

---

## Current system status (v2.1)

| Area | Status |
|------|--------|
| Multi-tenant companies | Live — login by company slug; platform owner registers tenants |
| Core ERP modules | Live — sales, inventory, production, finance, CRM, HR, delivery, quality, maintenance |
| Production host | Contabo VPS + Docker Compose + Caddy (TLS) |
| Schema sync | `prisma db push` on backend container start (`USE_DB_PUSH=true`) |
| Auth | JWT access + refresh, RBAC, optional TOTP 2FA, session expiry recovery |
| Mobile / PWA | Installable PWA with compact phone layouts |
| CI | GitHub Actions build + test + MySQL health checks |

### What’s new since v2.0 (highlights)

- **Multi-tenant SaaS** — per-company isolation, platform owner workspace, company registration
- **Super Admin seats** — up to two Super Admins per company (configurable)
- **Leave management** — yearly balances (annual 21 / sick 7 / compassionate 5 / paternity 14 / maternity 90), My Leave cards, HR amend, on-leave view, Excel/PDF leave reports, yearly reset
- **My Sales & targets** — salesperson dashboard, monthly targets, outstanding AR for the salesperson
- **Backdated sales orders** — record past order dates (not future; max 365 days back)
- **Searchable product picker** — search by name/SKU **and** dropdown browse (1000+ catalog friendly)
- **Customer activate / deactivate** — inactive customers stay listable and can be reactivated
- **Delivery trips** — multi-stop trips, dispatch, proof of delivery flows
- **Journal entry ledger** — GL journal support
- **Tenant isolation hardening** — `companyId` scoping across tenant models
- **Mobile density** — compact cards/lists for Android-like phone use
- **Production stack** — Docker + Caddy HTTPS for `abexcore.co.ke`

---

## Technology stack

| Layer | Technologies |
|-------|--------------|
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 4, TanStack Query, React Router 7, React Hook Form, Zod, Chart.js, Vite PWA |
| Backend | Node.js 20+, Express, TypeScript, Prisma 6, JWT, bcrypt, Multer, Nodemailer, PDFKit, ExcelJS |
| Database | MySQL 8+ |
| Deployment | Docker Compose, Caddy (TLS), Nginx (app frontend container), Contabo / Ubuntu |

---

## Modules

1. **Dashboard** — KPIs, charts, sales metrics, production status, low-stock alerts  
2. **User management** — roles & RBAC, departments, branches, audit logs, 2FA, Super Admin quota  
3. **Company / settings** — profile, warehouses, tax rates, email config, catalog managers  
4. **CRM** — customers (types + VAT/Non-VAT), contacts, credit, complaints, opportunities, warranty; activate/deactivate  
5. **Products** — categories, SKU/barcode/part number, pricing, images, searchable picker  
6. **Raw materials** — material types, stock, reorder  
7. **Suppliers & procurement** — requisition → RFQ → PO → GRN → AP  
8. **Inventory** — multi-warehouse, transfers, adjustments, cycle counts  
9. **Production** — work orders, machines, completion, stock receipt  
10. **Quality** — incoming / production / finished inspections  
11. **Sales** — quotations, orders (incl. backdate), invoices, My Sales, sales targets / performance  
12. **Delivery** — notes, trips, vehicles/drivers, POD  
13. **Finance** — GL / journal, AP/AR, VAT, bank reconciliation, P&L, balance sheet, cash flow, M-Pesa (stub/live)  
14. **HR** — employees (gender), leave requests & balances, payroll, on-leave today, leave Excel/PDF  
15. **Maintenance** — requests & schedules  
16. **Reports** — sales, inventory, production, financial statements, leave balances  
17. **Platform** — register companies (platform owner only), demo workspace tooling  

---

## Quick start (development)

### Prerequisites

- Node.js **20+**
- MySQL **8+** (or Docker)
- npm

### Setup

```bash
# 1. Clone and install
git clone https://github.com/kimutaicosmas-kck/Abexcore.git
cd Abexcore
npm install
cd backend && npm install
cd ../frontend && npm install

# 2. Environment
cp backend/.env.example backend/.env
# Edit DATABASE_URL, JWT secrets, PLATFORM_OWNER_* as needed

# 3. MySQL (Docker)
docker compose up mysql -d

# 4. Schema + seed
cd backend
npx prisma db push
npm run db:seed
# or production-style seed:
# npm run db:seed:production

# 5. Dev servers (repo root)
cd ..
npm run dev
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3001 |
| OpenAPI / Swagger | http://localhost:3001/api/docs (when `SWAGGER_ENABLED=true` or non-production) |
| Health | http://localhost:3001/api/health |

### Default login (local / seeded platform owner)

Credentials come from environment (see `backend/.env.example`):

| Field | Env var | Typical local default |
|-------|---------|------------------------|
| Company slug | `PLATFORM_COMPANY_SLUG` | `owner` |
| Email | `PLATFORM_OWNER_EMAIL` | value in `.env` |
| Password | `PLATFORM_OWNER_PASSWORD` / `SEED_ADMIN_PASSWORD` | value in `.env` |

Production seeds set **must change password** on first login. Never commit real production passwords to git.

---

## Docker / production

### Local all-in-one

```bash
docker compose up -d --build
```

### Contabo / production (TLS via Caddy)

```bash
cd ~/Abexcore   # on the server
git pull origin main
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build
```

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the full go-live checklist (secrets, backups, TLS, Contabo).

Public production site: **https://abexcore.co.ke**

---

## Project structure

```
Abexcore/
├── frontend/               # React 19 + Vite + Tailwind + PWA
│   └── src/
│       ├── components/     # UI, forms (incl. ProductSearchSelect), layout
│       ├── pages/          # Module pages
│       ├── services/       # Axios API client
│       ├── contexts/       # Auth / session
│       ├── hooks/          # Shared hooks
│       └── types/
├── backend/                # Express + Prisma API
│   ├── prisma/             # Schema, migrations, seeds
│   ├── scripts/            # Ops / migration helpers
│   └── src/
│       ├── routes/
│       ├── services/
│       ├── middleware/
│       ├── utils/
│       └── validators/
├── docker/                 # Dockerfiles, Caddyfile, nginx
├── database/               # MySQL init
├── e2e/                    # Playwright smoke tests
├── scripts/                # Backup, load test, Contabo helpers
├── .github/workflows/      # CI, backup schedule, staging deploy
├── COMPLIANCE.md
├── DEPLOYMENT.md
├── ADMIN_GUIDE.md
└── USER_GUIDE.md
```

---

## API surface (`/api/v1`)

| Module | Base path | Notes |
|--------|-----------|--------|
| Auth | `/auth` | Login (company slug), refresh, 2FA, password |
| Dashboard | `/dashboard` | KPIs, charts |
| Users | `/users` | Users, roles, departments, audit |
| Customers / CRM | `/customers`, `/crm` | Customers, complaints, opportunities, warranty |
| Products | `/products` | Catalog, categories, images, available stock |
| Inventory | `/inventory` | Materials, warehouses, stock, procurement |
| Operations | `/operations` | Sales orders, quotations, production |
| Delivery | `/delivery` | Delivery notes & trips |
| Finance | `/finance` | Invoices, payments, GL, reports, notifications, sales targets |
| HR | `/hr` | Employees, leave, balances, payroll, leave reports |
| Quality | `/quality` | Inspections |
| Maintenance | `/maintenance` | Requests / schedules |
| Search | `/search` | Global search |
| Tenant / platform | `/tenant` | Company registration (platform owner) |
| M-Pesa | `/mpesa` / finance callbacks | STK / callback (stub or live) |
| Realtime | `/realtime` | SSE live refresh |
| Health | `/api/health` | Liveness + DB + integrations |

Generate OpenAPI paths: `npm run openapi:generate --prefix backend`

---

## Enterprise readiness

| Capability | Location |
|------------|----------|
| CI build & tests | `.github/workflows/ci.yml` |
| Scheduled DB backups | `.github/workflows/backup-schedule.yml`, `scripts/backup-mysql.sh` |
| Backup restore test | `scripts/test-backup-restore.sh` |
| Staging deploy workflow | `.github/workflows/deploy-staging.yml` |
| Audit logging | `backend/src/utils/audit.ts`, mutation audit middleware |
| Compliance | [COMPLIANCE.md](./COMPLIANCE.md) |
| Admin / user guides | [ADMIN_GUIDE.md](./ADMIN_GUIDE.md), [USER_GUIDE.md](./USER_GUIDE.md) |
| Deployment runbook | [DEPLOYMENT.md](./DEPLOYMENT.md) |
| Frontend unit tests | `npm test --prefix frontend` |
| Backend API tests | `npm test --prefix backend` |
| E2E smoke | `npm run test:e2e` |
| Load test | `npm run load-test` |
| Purge legacy tenants | `npm run db:purge-legacy` |

---

## Security

- JWT access tokens (short-lived) + rotating refresh tokens  
- Role-based access control (permissions per role; Super Admin bypass)  
- bcrypt password hashing; optional forced password change  
- Rate limiting, Helmet, CORS allow-list  
- Zod request validation  
- Tenant scoping via `companyId`  
- Audit trail for sensitive mutations  
- Optional TOTP 2FA (secrets encrypted at rest)  
- Production secrets via server `.env` only — never commit `.env`

---

## Useful npm scripts (repo root)

```bash
npm run dev                 # backend + frontend
npm run build               # build both
npm run db:seed             # development seed
npm run db:seed:production  # production / Contabo-style seed
npm run test:e2e            # Playwright smoke
npm run load-test           # health endpoint load script
```

---

## License

Proprietary — **AbexCore Technologies**. All rights reserved.
