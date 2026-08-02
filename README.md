# AbexCore ERP v2.1 — Designed by AbexCore Technologies

Enterprise-grade ERP for manufacturing and distribution. Manages the complete business lifecycle from raw material procurement through production, inventory, sales, finance, distribution, CRM, HR, and maintenance.

## What's New in v2.0

- **Financial statements** — P&L, Balance Sheet, Cash Flow, and VAT reports (API + UI)
- **Global search** — Search customers, products, orders, and suppliers from the top nav
- **RFQ workflow** — Requisition → Approve → Create RFQ → Supplier quotes
- **Email notifications** — Nodemailer integration for approvals and low-stock alerts
- **Bank reconciliation** — Match bank payments against GL
- **BOM editor** — Visual bill-of-materials editor on Products page
- **Product images** — Upload product photos via Multer
- **Automated tests** — Vitest + Supertest API tests
- **CI/CD** — GitHub Actions pipeline (build + test)
- **Production Docker** — Health checks, Prisma migrations on startup

## Technology Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, React Hook Form, Zod, Chart.js |
| Backend | Node.js, Express.js, TypeScript, Prisma ORM, JWT Auth, bcrypt, Multer, Nodemailer, PDFKit, ExcelJS |
| Database | MySQL 8+ |
| Deployment | Docker, Nginx, PM2, Ubuntu Server |

## Modules

1. **Dashboard** - KPIs, charts, sales metrics, production status, low stock alerts
2. **User Management** - 13 roles, RBAC permissions, departments, audit logs, 2FA
3. **Company Settings** - Profile, branches, warehouses, tax rates, email config
4. **CRM** - Customers (dealers, retail, industry, government, NGOs), contacts, credit limits, quotations, complaints, warranty
5. **Product Management** - 8 filter categories, SKU/barcode, BOM, pricing tiers
6. **Raw Materials** - 10 material types, batch tracking, expiry, reorder alerts
7. **Supplier Management** - Performance rating, lead time, contracts
8. **Procurement** - Requisition → Approval → RFQ → PO → Goods Receipt → Invoice → Payment
9. **Inventory** - Multi-warehouse, stock levels, transfers, adjustments, cycle counts
10. **Production Planning** - Work orders, machine scheduling, capacity planning
11. **Bill of Materials** - Auto-deduct materials during production
12. **Manufacturing Execution** - Material consumption, waste, quality inspection
13. **Quality Control** - Incoming, in-process, finished product inspections
14. **Sales** - Quotation → Order → Production → Dispatch → Invoice → Payment
15. **Delivery** - Vehicle/driver assignment, routes, proof of delivery
16. **Finance** - GL, AP/AR, VAT, bank reconciliation, P&L, balance sheet
17. **HR** - Employees, attendance, leave, payroll
18. **Maintenance** - Machine schedules, repairs, service history
19. **Reports** - Sales, purchase, inventory, production, financial statements

## Quick Start

### Prerequisites

- Node.js 20+
- MySQL 8+ (or Docker)
- npm

### Development Setup

```bash
# 1. Clone and install
cd "APEXCORE ERP"
npm install
cd backend && npm install
cd ../frontend && npm install

# 2. Configure environment
cp backend/.env.example backend/.env
# Edit DATABASE_URL in backend/.env

# 3. Start MySQL (if using Docker)
docker-compose up mysql -d

# 4. Run database migrations and seed
cd backend
npx prisma migrate dev --name init
npm run db:seed

# 5. Start development servers
cd ..
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001
- API Docs: http://localhost:3001/api/docs

### Default Login (platform owner workspace)

```
Company slug: owner
Email: kimutaicosmas547@gmail.com
Password: Kimutai@44!
```

### Enterprise readiness

| Capability | Location |
|------------|----------|
| Scheduled DB backups | `.github/workflows/backup-schedule.yml`, `scripts/backup-mysql.sh` |
| Backup restore test | `scripts/test-backup-restore.sh`, CI job `backup-restore` |
| Audit logging | `backend/src/utils/audit.ts`, inventory/tenant/auth coverage |
| OpenAPI (164 routes) | `npm run openapi:generate --prefix backend`, `/api/docs` |
| Frontend unit tests | `npm test --prefix frontend` |
| E2E smoke tests | `npm run test:e2e` |
| Staging deploy | `.github/workflows/deploy-staging.yml` |
| Compliance docs | `COMPLIANCE.md` |
| Load tests | `scripts/load-test/health-load.mjs` |
| Remove legacy demo tenants | `npm run db:purge-legacy` |

### Rename project folder

Close the IDE, then run `scripts/rename-to-apexcore.ps1` to rename `Amazon ERP` → `APEXCORE ERP`.

### Docker Production

```bash
docker-compose up -d
```

- Frontend: http://localhost
- Backend: http://localhost:3001

## Project Structure

```
erp-system/
├── frontend/          # React 19 + Vite + Tailwind
│   └── src/
│       ├── components/  # UI components, layouts
│       ├── pages/       # Module pages
│       ├── services/    # API client
│       ├── contexts/    # Auth context
│       └── types/       # TypeScript types
├── backend/           # Express + Prisma API
│   ├── prisma/          # Schema, migrations, seed
│   └── src/
│       ├── controllers/ # Route handlers
│       ├── routes/      # API routes
│       ├── services/    # Business logic
│       ├── middleware/   # Auth, validation, audit
│       └── validators/  # Zod schemas
├── docker/            # Dockerfiles, nginx config
├── database/          # SQL init scripts
├── uploads/           # File uploads
└── reports/           # Generated reports
```

## API Endpoints

| Module | Base Path | Description |
|--------|-----------|-------------|
| Auth | `/api/v1/auth` | Login, refresh, 2FA, password |
| Dashboard | `/api/v1/dashboard` | KPIs, charts |
| Users | `/api/v1/users` | CRUD, roles, audit logs |
| Customers | `/api/v1/customers` | CRM management |
| Products | `/api/v1/products` | Catalog, BOM |
| Inventory | `/api/v1/inventory` | Materials, stock, warehouses |
| Operations | `/api/v1/operations` | Sales, production |
| Finance | `/api/v1/finance` | Invoices, payments, HR, reports |

## Security

- JWT authentication with refresh tokens
- Role-based access control (13 roles, 70+ permissions)
- bcrypt password hashing with policy enforcement
- Rate limiting, Helmet security headers
- Input validation with Zod
- Comprehensive audit logging
- Optional two-factor authentication (TOTP)

## License

Proprietary — AbexCore Technologies
