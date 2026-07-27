# ApexCore ERP — Enterprise Technical Assessment

**Document type:** Authoritative technical audit (read-only)  
**Product:** ApexCore ERP  
**Root version (package.json):** 2.1.0  
**Backend / frontend package.json versions:** 2.0.0 (version skew)  
**Audit date:** 2026-07-27  
**Codebase path:** `C:\Users\Public\APEXCORE ERP`  
**Method:** Static inspection of repository artifacts only. No application code was modified. No tests were executed. No dependencies were installed. No destructive operations were performed.  
**Source prompt:** project-root file `audit`

---

## Executive Summary

ApexCore ERP is a **multi-tenant manufacturing and distribution ERP** delivered as an **npm-orchestrated monorepo** with:

- **Backend:** Node.js + Express + TypeScript + Prisma ORM + MySQL 8  
- **Frontend:** React 19 + Vite 6 + Tailwind CSS 4 + TanStack Query + React Router 7  
- **Ops:** Docker Compose, GitHub Actions CI, Nginx frontend image, backup/restore scripts  

The system implements a broad ERP surface: CRM, products/BOM, inventory, procurement, production, quality, sales, delivery (including delivery-note PDF), finance/GL, bank reconciliation, M-Pesa, HR, maintenance, reports, tenant registration, and platform-owner administration.

**Production readiness (overall): 6.5 / 10** — functionally rich and structured for enterprise workflows, with meaningful security and tenant controls, but limited automated test depth on the frontend, incomplete controller layering, tenant-scoping gaps on some `companyId` models, public upload serving, and operational maturity that still depends on manual/staging “instructional” deploy steps.

This document is the single audit deliverable. Observations are separated from recommendations.

---

## 1. Architecture Overview

### 1.1 Style

- **Monolith API** (Express) + **SPA frontend** (Vite/React)  
- **Shared MySQL** database with **row-level multi-tenancy** via `companyId`  
- **Request-scoped tenant context** via AsyncLocalStorage (`backend/src/utils/tenant.ts`)  
- **Prisma client extension** injects tenant filters for models listed in `backend/src/config/tenantModels.ts`

### 1.2 Request lifecycle (authenticated)

```
Browser SPA
  → HTTP /api/v1/*
  → helmet / CORS / compression / cookie-parser / (prod) global rate limit
  → authenticate (JWT) → runWithTenant(companyId)
  → authorize(permission) / validate(zod)
  → route handler (often inline) → service → Prisma
  → audit middleware (selected mutations)
  → JSON response / PDF / file download
```

Static assets: `/uploads` served by Express without authentication (`backend/src/app.ts`).

Health: `/api/health`, `/api/health/live`, `/api/health/ready` (outside `/api/v1`).

### 1.3 Architecture diagrams (textual)

**System context**

```
[Users / Drivers / Platform Owner]
        |
   [React SPA :5173/80]
        |  REST + SSE-ish realtime + file download
   [Express API :3001]
        |
   [MySQL 8]
        |
   [SMTP] [M-Pesa Daraja] [Sentry optional] [KRA eTIMS stub]
```

**Order-to-cash (evidenced)**

```
SalesOrder (READY)
  → DeliveryNote / DeliveryTrip (delivery-trip.service)
  → stock deduction + COGS
  → FinanceInvoiceService.createSalesInvoiceFromDelivery
  → Invoice + accounting postings
  → Delivery note PDF (export.service)
```

Evidence: `backend/src/services/delivery-trip.service.ts`, `backend/src/services/finance.service.ts`, `backend/src/services/export.service.ts`.

---

## 2. Repository Overview

### 2.1 Layout

| Path | Purpose |
|------|---------|
| `backend/` | Express/Prisma API |
| `frontend/` | Vite/React SPA |
| `e2e/` | Playwright smoke tests |
| `scripts/` | Backup, MySQL helpers, load-test, rename |
| `docker/` | Backend/frontend Dockerfiles, nginx.conf |
| `database/` | MySQL init mount for Compose |
| `.github/workflows/` | CI, staging instructions, backup schedule |
| `DEPLOYMENT.md`, `README.md`, `COMPLIANCE.md`, `ADMIN_GUIDE.md`, `USER_GUIDE.md`, `ROADMAP.md` | Product/ops documentation |
| `audit` | External audit prompt (this assessment’s instruction source) |
| `render.yaml`, `netlify.toml`, `docker-compose.yml` | Deploy manifests |

### 2.2 Monorepo model

Root `package.json` scripts orchestrate backend/frontend via `npm run --prefix`. Not a published npm workspaces package graph; practical monorepo orchestration.

### 2.3 Ownership relationships

| Component | Owns |
|-----------|------|
| Backend | Persistence, RBAC, tenant isolation, business rules, integrations |
| Frontend | UX, route gating, forms, PWA shell |
| Prisma schema | Canonical data model |
| CI | Build/test/backup verification gates |

---

## 3. Technology Inventory

| Technology | Version (manifest) | Where used | Criticality |
|------------|-------------------|------------|-------------|
| Node.js | CI uses 20 | Runtime | Critical |
| TypeScript | via backend/frontend toolchains | All app code | Critical |
| Express | ^4.21.2 | API | Critical |
| Prisma | ^6.5.0 | ORM | Critical |
| MySQL | 8.0 (Compose image) | Database | Critical |
| React | ^19.0.0 | UI | Critical |
| Vite | ^6.2.2 | Frontend build | Critical |
| Tailwind CSS | ^4.0.14 | Styling | High |
| TanStack Query | ^5.69 | Server state | High |
| React Router | ^7.4 | Routing | High |
| Zod | backend + frontend | Validation | High |
| JWT / bcrypt / speakeasy | backend deps | Auth/2FA | Critical |
| Helmet / express-rate-limit | backend | Security | High |
| Multer / Sharp | backend | Uploads/images | Medium |
| PDFKit / ExcelJS | backend | Exports | Medium |
| Nodemailer | backend | Email | Medium |
| Chart.js | frontend | Dashboards | Medium |
| vite-plugin-pwa | frontend | PWA | Medium |
| Vitest | backend ^3.0.9 / frontend ^3.2.7 | Unit/API tests | High |
| Playwright | ^1.52.0 | E2E | Medium |
| Docker Compose | root | Local/prod stack | High |
| Winston | backend | Logging | High |
| @sentry/node | optional | Error monitoring | Medium |
| Swagger UI | backend | API docs | Low–Medium |

**Evidence:** `package.json`, `backend/package.json`, `frontend/package.json`, `docker-compose.yml`.

**Replacement difficulty:** High for Prisma/MySQL/Express/React core; Medium for Chart.js/PWA; Low for optional Sentry.

---

## 4. Infrastructure Overview

### 4.1 Docker Compose (`docker-compose.yml`)

Services:

1. **mysql** — MySQL 8.0, DB `filter_erp`, user `erp_user`, healthcheck, volume `mysql_data`  
2. **backend** — built from `docker/Dockerfile.backend`, port 3001, depends on healthy MySQL  
3. **frontend** — Nginx image from `docker/Dockerfile.frontend`, port 80  

Volumes: `mysql_data`, `uploads`, `reports`.

### 4.2 CI/CD (`.github/workflows/`)

| Workflow | Behavior |
|----------|----------|
| `ci.yml` | Backend: Prisma generate/push/seed, OpenAPI generate, build, Vitest, health load test. Frontend: Vitest + build. E2E Playwright after backend+frontend. Backup-restore job. Docker build job after predecessors. |
| `deploy-staging.yml` | Build verification + echoed deploy instructions (no automated remote deploy evidenced) |
| `backup-schedule.yml` | Scheduled backup using secrets |

### 4.3 Alternate hosting

- `render.yaml` — API Docker + static web  
- `netlify.toml` — frontend SPA + security headers  
- `DEPLOYMENT.md` — Railway/Vercel/Oracle free-tier guidance  

### 4.4 Observation

Staging deploy is **instructional**, not a closed-loop production CD pipeline.

---

## 5. Database Audit

### 5.1 Engine

- **Provider:** MySQL (`backend/prisma/schema.prisma` datasource)  
- **Logical DB name in examples:** `filter_erp` (legacy naming)  
- **Models:** **67** Prisma models  

### 5.2 Model groups

| Domain | Models (representative) |
|--------|-------------------------|
| Tenant/org | Company, Branch, TaxRate, EmailConfig, Department |
| IAM | Role, Permission, RolePermission, User, RefreshToken, LoginHistory, AuditLog |
| Notifications | Notification |
| CRM | Customer, CustomerContact, Opportunity, Complaint, Warranty |
| Catalog | ProductCategory, Product, MaterialType, RawMaterial, BillOfMaterial* |
| Inventory | Warehouse*, StockLevel, InventoryTransaction |
| Procurement | Supplier*, PurchaseRequisition*, RFQ, SupplierQuotation, PurchaseOrder*, GoodsReceipt* |
| Production | Machine, ProductionOrder, ProductionBatch, ProductionConsumption |
| Quality | QualityInspection |
| Sales | SalesQuotation*, SalesOrder*, SalesTarget |
| Delivery | Vehicle, DeliveryTrip, DeliveryNote, DeliveryItem |
| Finance | Account, JournalEntry*, Invoice*, Payment*, BankStatement*, MpesaTransaction |
| HR | Employee, Attendance, LeaveRequest, PayrollRecord |
| Maintenance | MaintenanceRequest |

### 5.3 Migrations inventory (`backend/prisma/migrations/`)

1. `20250714000000_v2_bank_reconciliation`  
2. `20250714120000_production_hardening`  
3. `20250720150000_performance_indexes`  
4. `20250722120000_delivery_trips`  
5. `20250724100000_notification_delivery_type`  
6. `20250724120000_quality_inspection_product`  
7. `20250727100000_journal_entry_ledger`  
8. `20250727120000_tenant_isolation_hardening`  
9. `20250727140000_user_allowed_modules`  

Plus `migration_lock.toml`.

### 5.4 Seeds

- `prisma/seed.ts` — demo-oriented seed  
- `prisma/seed.production.ts` — roles/admin shell  
- `services/demoDataSeed.service.ts` — platform-owner demo data only  

### 5.5 Tenant isolation (data layer)

**Scoped models** (Prisma extension): listed in `TENANT_SCOPED_MODELS` (35 models including User, Customer, Product, SalesOrder, DeliveryNote, Invoice, Payment, JournalEntry, etc.).

**Gaps (schema has `companyId` but not in scoped set — evidenced):**

- `Branch`  
- `TaxRate`  
- `MpesaTransaction`  

Child tables without direct `companyId` (e.g. `DeliveryItem`, `SalesOrderItem`, `StockLevel`) rely on parent joins / manual filters.

### 5.6 Data governance (documented)

`COMPLIANCE.md` states tenant isolation by `companyId`, retention guidance (audit 24 months, financial 7 years), and company deletion via platform owner API.

---

## 6. Backend Audit

### 6.1 Entry points

- `backend/src/index.ts` — process bootstrap, monitoring init, low-stock checks, shutdown  
- `backend/src/app.ts` — middleware stack, health, `/api/v1` router, uploads static, Swagger  

### 6.2 API surface

**17 route modules** mounted under `/api/v1`:

`auth`, `dashboard`, `users`, `customers`, `products`, `inventory`, `operations`, `finance`, `finance/mpesa`, `hr`, `delivery`, `crm`, `quality`, `maintenance`, `search`, `realtime`, `tenant`

**OpenAPI:** `backend/src/openapi/paths.yaml` — **164 paths**, ~**205** operations (generated via `scripts/generate-openapi-paths.ts`).

### 6.3 Layering

| Layer | State |
|-------|-------|
| Controllers | Partial — only `auth.controller.ts`, `dashboard.controller.ts` |
| Routes | Fat handlers for most modules |
| Services | ~29 modules under `src/services/` |
| Validators | Central Zod `validators/schemas.ts` + some local schemas |
| Middleware | auth, validate, rateLimiters, upload, auditLog, mutationAudit, integrationGuard, errorHandler |

### 6.4 Key services (business)

| Service | Responsibility |
|---------|----------------|
| `auth.service.ts` | Login, JWT, 2FA, password policy |
| `sales-order.service.ts` | Order lifecycle, production linkage, delivery readiness |
| `delivery-trip.service.ts` | Delivery notes/trips, stock out, invoice trigger |
| `finance.service.ts` | Invoices/payments; invoice-from-delivery rule |
| `accounting.service.ts` | Journal postings |
| `bank-reconciliation.service.ts` | Statement import/match |
| `mpesa.service.ts` | STK / callbacks (stub/live) |
| `kra-etims.service.ts` | Fiscal submission (stub when unset) |
| `tenant.service.ts` / `companyDeletion.service.ts` | Multi-company ops |
| `export.service.ts` | Invoice/delivery PDF, Excel reports |
| `demoDataSeed.service.ts` / `platformDemoReset.service.ts` | Owner demo workspace |

### 6.5 Uploads

`backend/src/middleware/upload.ts`:

- Product images: 5 MB, jpeg/png/webp/gif → `/uploads/products`  
- Company logos: 2 MB, includes **SVG** → `/uploads/companies`  

### 6.6 Health

| Endpoint | Role |
|----------|------|
| `/api/health/live` | Process liveness |
| `/api/health/ready` | DB + integration readiness |
| `/api/health` | Combined |

---

## 7. Frontend Audit

### 7.1 Routing

`frontend/src/App.tsx` — React Router nested under `AppLayout`, with:

- `ProtectedRoute`  
- `PasswordChangeRoute`  
- `PlatformOwnerRoute`  
- `PermissionRoute` (`config/routeAccess.ts`)

### 7.2 Pages (routed)

Login, Change Password, Dashboard, Users, Customers, Products, Inventory, Procurement, Production, Quality, Sales, My Sales, Sales Performance, Delivery, Finance, HR, Maintenance, Reports, Settings, Register Company, Not Found.

**Non-routed page modules:** `ErrorPage.tsx` (ErrorBoundary), `SalesTargetsPage.tsx` (panel embedded in Sales Performance; `/sales-targets` redirects).

### 7.3 State

- Auth: `AuthContext`  
- Server state: TanStack Query (staleTime ~10s, RealtimeSync invalidation, notification polling)  
- No Redux/Zustand evidenced  

### 7.4 Forms

35 form modules under `frontend/src/components/forms/` covering users/modules, CRM, catalog, procurement, production/quality, sales, delivery, finance, HR, maintenance.

### 7.5 UI kit

Custom kit in `components/ui` (Button, Input, NumberInput, Select, Modal, Table, Badge, StatCard, ConfirmDialog, PageQueryStatus, etc.). Not a third-party component library.

### 7.6 PWA

- `vite-plugin-pwa` in `vite.config.ts`  
- API calls NetworkOnly in Workbox  
- `PwaShell` offline/update/install UX  
- Icons in `frontend/public/`  

### 7.7 Branding

`constants/brand.ts`, `ApexCoreLogo`, `CompanyBrand`, `PoweredBy` — version constant `2.1.0`.

---

## 8. Mobile / Responsive Audit

| Area | Evidence | Assessment |
|------|----------|------------|
| Responsive sidebar | `AppLayout` / `Sidebar` off-canvas `<lg` | Implemented |
| Table stacking | `Table` `responsive` prop | Implemented |
| Touch / PWA | PwaShell, safe-area padding | Partial PWA maturity |
| Native mobile app | None in repo | N/A — web responsive only |
| Device APIs | No GPS/camera/Bluetooth app code evidenced | Not applicable |

**Usability score (mobile web): 6.5 / 10** — usable ERP shell on phone with caveats (dense tables/forms remain desktop-oriented).

---

## 9. UX / Product Audit

### 9.1 Primary users (from roles + UI)

| Role | Typical modules (defaults) |
|------|----------------------------|
| Super Admin / Platform Owner | All + company registration |
| Managing Director | All modules |
| Operations / Production / Procurement / Warehouse | Ops stack |
| Sales Officer | Customers, Sales (+ optional `allowedModules`) |
| Finance / Accountant | Finance, Reports |
| Driver | Delivery |
| HR / Customer Service / Auditor | Role-specific |

Evidence: `backend/src/config/rolePermissions.ts`, `frontend/src/utils/roleModules.ts`.

### 9.2 Critical journeys

1. **Register company** (platform owner) → invite/create users  
2. **Quote → Sales order → READY**  
3. **Delivery note / trip → PDF print → invoice auto-create**  
4. **Payments / M-Pesa / bank reconciliation**  
5. **Procurement PR → RFQ → PO → GRN → stock**  
6. **Production order → QC → finished goods**  

### 9.3 Feature catalogue (status)

| Feature | Status | Evidence |
|---------|--------|----------|
| Multi-tenant companies | Implemented | tenant routes/services, companyId |
| RBAC permissions | Implemented | RolePermission + authorize |
| Per-user module overrides | Implemented | `User.allowedModules`, UserForm ModuleAccessPicker |
| JWT + refresh + 2FA | Implemented | auth.service |
| CRM | Implemented | customers/crm routes + forms |
| Products/BOM/catalog | Implemented | products + catalog settings |
| Inventory | Implemented | inventory routes/forms |
| Procurement | Implemented | PR/RFQ/PO/GRN |
| Production | Implemented | operations + CompleteProductionForm |
| Quality | Implemented | quality routes/forms |
| Sales / quotations | Implemented | SalesPage forms |
| Delivery notes + trips + PDF | Implemented | DeliveryPage, export.service |
| Invoice-from-order blocked (goods with DN) | Implemented | finance.service messaging |
| Finance GL / journals | Implemented | accounting + JournalEntryForm |
| Bank reconciliation | Implemented | bank-reconciliation.service |
| M-Pesa | Implemented (stub/live) | mpesa.service |
| KRA eTIMS | Partial/stub | kra-etims.service; not in IntegrationRegistry |
| HR/payroll | Implemented | hr routes/forms |
| Maintenance | Implemented | maintenance routes/forms |
| Reports / Excel | Implemented | export + ReportsPage |
| Global search | Implemented | search.routes + GlobalSearch |
| Realtime invalidation | Implemented | RealtimeSync |
| Demo seed/reset (owner) | Implemented | demoDataSeed / platformDemoReset |
| Company deletion | Implemented | companyDeletion.service |
| Frontend unit tests | Minimal | only `brand.test.ts` |
| Staging auto-deploy | Incomplete | echo instructions only |

---

## 10. Security Audit

### 10.1 Controls present (evidence)

| Control | Location |
|---------|----------|
| Helmet (+ HSTS in production) | `app.ts` |
| CORS allowlist | `utils/corsOrigins.ts` |
| JWT access + refresh | `auth.service.ts` |
| Refresh token hashing | `utils/crypto.ts` |
| bcrypt password hashing | `auth.service.ts` |
| Password policy (length/case/digit) | `config` + AuthService |
| TOTP 2FA; encrypted secrets | speakeasy + AES-GCM |
| Login rate limit | `rateLimiters.ts` (login window 2 minutes) |
| Auth endpoint rate limit | `rateLimiters.ts` |
| Global rate limit in production | `app.ts` (500/15m) |
| Zod validation | `middleware/validate.ts` |
| RBAC authorize | `middleware/auth.ts` |
| Mutation audit | `mutationAudit.ts` / `audit.ts` |
| Swagger disabled by default in production | `config.swaggerEnabled` |
| Integration circuit breaker | `integrationGuard.ts` / `circuitBreaker.ts` |

### 10.2 Findings (severity)

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| S-01 | **High** | `/uploads` static is unauthenticated — product/logo URLs are world-readable if guessed/leaked | `app.ts` static mount |
| S-02 | **High** | Tenant-scoped Prisma set omits some models with `companyId` (`Branch`, `TaxRate`, `MpesaTransaction`) | `tenantModels.ts` vs `schema.prisma` |
| S-03 | **High** | M-Pesa callback secret check is conditional — empty secret means no shared-secret verification | `mpesa.routes.ts` pattern (env optional) |
| S-04 | **Medium** | Company logo upload allows SVG (scriptable content risk if mis-served) | `upload.ts` |
| S-05 | **Medium** | SMTP password field on `EmailConfig` is plain string in schema | `schema.prisma` |
| S-06 | **Medium** | Dev secret fallbacks for JWT/encryption when env unset | `config/index.ts` `requireSecret` |
| S-07 | **Medium** | Example env contains platform owner default password | `backend/.env.example` |
| S-08 | **Medium** | Super Admin bypasses permission checks by role name | `authorize` in `auth.ts` |
| S-09 | **Low** | Password special-character requirement disabled | `passwordPolicy.requireSpecial: false` |
| S-10 | **Low** | JSON body limit 10mb | `app.ts` |
| S-11 | **Informational** | CORS allows requests with no `Origin` | `corsOrigins` / CORS callback |
| S-12 | **Informational** | Legacy DB/admin naming (`filter_erp`, `@filtererp.co.ke`) increases misconfiguration risk | Compose/seed/docs |

### 10.3 AuthZ model note

Permissions are `module:action` strings. Users may have `allowedModules` JSON overriding role defaults (`userPermissions.ts`). Role name still drives some business rules (e.g. Sales Officer scoping, Driver delivery views).

---

## 11. Performance Audit (static estimate)

| Area | Observation | Evidence |
|------|-------------|----------|
| N+1 risk | Route/service includes vary; list endpoints commonly use Prisma `include` | route files |
| Indexes | Dedicated migration `20250720150000_performance_indexes` | prisma/migrations |
| Pagination | Cursor/page helpers exist (`cursorPagination.ts`, page/limit schemas) | utils + validators |
| Frontend bundle | Vite SPA; PWA caching excludes API (NetworkOnly) | vite.config.ts |
| Realtime | Polling + event invalidation (not full websocket bus for all data) | RealtimeSync |
| Background work | In-process low-stock interval in `index.ts` (not separate worker fleet) | index.ts |
| Horizontal scale | Sticky sessions not required for JWT; uploads/reports are local volumes — multi-instance needs shared storage | Compose volumes |

**Bottleneck hypotheses (not measured):** large finance/delivery includes; report generation; mysqldump backup of growing DB; single-node upload disk.

---

## 12. Testing Audit

| Suite | Location | Scope | Maturity |
|-------|----------|-------|----------|
| Backend Vitest | `backend/tests/*.test.ts` | API/auth/catalog/CRM/dashboard/finance/operations/users/workflows | Moderate |
| Frontend Vitest | `frontend/src/constants/brand.test.ts` | Branding only | Minimal |
| Playwright E2E | `e2e/specs/smoke.spec.ts` | Smoke | Minimal–Moderate |
| Load | `scripts/load-test/health-load.mjs` | Health endpoints in CI | Narrow |
| Backup restore | `scripts/test-backup-restore.sh` | CI job | Present |

**No tests were executed for this audit.**

**Coverage gap:** frontend pages/forms largely untested by unit tests; E2E surface is smoke-level.

---

## 13. Observability Audit

| Capability | Status | Evidence |
|------------|--------|----------|
| Structured logging | Present | Winston (`config/logger`) |
| Health live/ready | Present | `app.ts` |
| Integration status in health | Present | registry (mpesa/email/database) |
| Sentry | Optional | `utils/monitoring.ts`, optionalDependency |
| Metrics/tracing/APM | Not evidenced as first-class | — |
| Alerting dashboards | Not in-repo | — |
| Audit trail (business) | Present | AuditLog + mutationAudit |

KRA eTIMS service exists but is **not** listed in the integration registry health surface (partial observability for that integration).

---

## 14. Resource Utilization (estimated)

| Resource | Idle (dev) | Peak (est.) | Notes |
|----------|------------|-------------|-------|
| API RAM | ~150–300 MB | 512 MB–1 GB | Node + Prisma |
| MySQL RAM | ~256–512 MB | 1–2 GB+ | Depends on data |
| Disk | Repo + `uploads` + `reports` + DB volume | Growing with attachments/PDFs | |
| CPU | Low idle | Spikes on PDF/Excel/seed/backup | |
| Network | SPA assets + JSON API | M-Pesa/SMTP external | |

Infrastructure cost drivers: MySQL size, upload retention, backup frequency.

---

## 15. System Relationship Map

```
Frontend (React)
  ├─ AuthContext ──► /api/v1/auth
  ├─ api.ts ────────► /api/v1/*
  ├─ RealtimeSync ──► /api/v1/realtime
  └─ downloadFile ──► PDF/Excel endpoints

Backend (Express)
  ├─ Prisma ────────► MySQL
  ├─ EmailService ──► SMTP
  ├─ MpesaService ──► Daraja
  ├─ KraEtims ──────► KRA API (stub/live)
  ├─ ExportService ─► PDFKit/ExcelJS → reports/uploads
  └─ Monitoring ────► Sentry (optional)

CI (GitHub Actions)
  ├─ MySQL service
  ├─ Vitest / Playwright / load-test / backup-restore
  └─ docker compose build

Deploy
  ├─ docker-compose (mysql+api+nginx)
  ├─ render.yaml / netlify.toml
  └─ DEPLOYMENT.md manual paths
```

---

## 16. Code Quality Assessment

| Dimension | Assessment | Evidence |
|-----------|------------|----------|
| Architecture consistency | Mixed | Strong service extraction in some domains; many fat routes |
| Naming | Generally clear | Occasional legacy `filter_erp` / Filter branding |
| Coupling | Medium–High in routes | Inline Prisma/business logic in route files |
| Duplication | Moderate | Dual `.env.example`; role module maps mirrored FE/BE |
| Dead code | Low–Moderate | SalesTargets page redirected; ErrorPage not routed |
| Documentation | Good for ops | README, DEPLOYMENT, COMPLIANCE, guides |
| Maintainability | Moderate | Large Zod schema file; OpenAPI generated stubs |
| Upgrade readiness | Moderate | React 19 / Vite 6 relatively current; Prisma 6 |

**Technical debt themes:** incomplete controller layer; tenant model registry drift; legacy naming; thin frontend tests; staging CD not automated.

---

## 17. Production Readiness Assessment

| Pillar | Score /10 | Notes |
|--------|-----------|-------|
| Reliability | 6 | Health checks, graceful shutdown; single-process background jobs |
| Availability | 6 | Compose restart policies; no multi-AZ design in-repo |
| Recoverability | 7 | Backup/restore scripts + CI backup-restore job |
| Maintainability | 6 | Docs strong; layering uneven |
| Observability | 5 | Logs + health; limited APM/metrics |
| Security | 6 | Solid baseline controls; upload/tenant/callback gaps |
| Scalability | 5 | Vertical-friendly; shared disk for uploads |
| Deployability | 6 | Docker good; staging workflow instructional |
| Disaster recovery | 5 | Backup guidance; DR runbooks partial |
| Operational maturity | 6 | COMPLIANCE + ADMIN guides; retention jobs “recommended” not coded as scheduler product |

**Overall production readiness: 6.5 / 10**

Suitable for controlled staging/UAT and careful production with hardening checklist in `DEPLOYMENT.md`. Not yet “hyperscale enterprise platform” maturity.

---

## 18. Scalability Assessment

- **Vertical:** Feasible (larger MySQL + Node instance).  
- **Horizontal API:** Possible with JWT; requires shared upload/report storage and sticky-free design.  
- **Workers:** Background tasks currently in API process — extract for scale.  
- **DB:** Indexes migration present; growth of ledger/delivery/audit tables needs monitoring.  

---

## 19. Maintainability Assessment

Strengths: domain services for critical workflows; Zod validation; generated OpenAPI path stubs; multi-tenant utilities; seed/migration scripts.

Weaknesses: fat routes; FE/BE role maps duplicated; version number skew (2.1.0 vs 2.0.0 packages); incomplete automated UI testing.

---

## 20. Risk Register

| Risk | Likelihood | Impact | Related findings |
|------|------------|--------|------------------|
| Cross-tenant data leak via unscoped models | Medium | High | S-02 |
| Sensitive file exposure via `/uploads` | Medium | High | S-01 |
| Unauthorized M-Pesa callback processing | Medium | High | S-03 |
| Operational deploy mistakes (manual staging) | Medium | Medium | Infra §4.2 |
| Regression in UI without FE tests | High | Medium | Testing §12 |
| Credential leakage from example defaults | Medium | Medium | S-07 |
| SVG logo XSS vector | Low | Medium | S-04 |

---

## 21. Critical Findings

1. **Tenant isolation registry incomplete** relative to schema `companyId` columns (`Branch`, `TaxRate`, `MpesaTransaction`).  
2. **Unauthenticated static uploads** expose stored files to anyone with URL.  
3. **M-Pesa callback authentication is optional** when secret unset.  
4. **Frontend automated test coverage is negligible** beyond branding.  
5. **Version/branding legacy residue** (`filter_erp`, package 2.0.0 vs product 2.1.0) increases operational confusion.  
6. **Delivery→invoice path is intentional and implemented**; order-only sales invoicing is blocked in service messaging — aligns with “goods with delivery note” business rule.  

---

## 22. Recommendations

*(Clearly separated from observations. Not implemented by this audit.)*

1. Add `Branch`, `TaxRate`, `MpesaTransaction` (and review all `companyId` models) to `TENANT_SCOPED_MODELS`; add regression tests for cross-tenant denial.  
2. Serve uploads through authenticated/signed URLs or private object storage; disallow SVG or sanitize aggressively.  
3. Require `MPESA_CALLBACK_SECRET` in live mode; fail closed.  
4. Encrypt SMTP passwords at rest (reuse `crypto.ts`).  
5. Expand frontend Vitest + broaden Playwright beyond smoke.  
6. Align package versions and retire `filter_erp` naming in new environments.  
7. Extract fat routes into controllers/services consistently.  
8. Replace staging “echo deploy” with real environment deploy + migration gate.  
9. Move low-stock and similar jobs to an external scheduler/worker.  
10. Add KRA eTIMS to integration registry/health for operational visibility.  

---

## 23. Statistics

| Metric | Value | Evidence basis |
|--------|-------|----------------|
| Prisma models | 67 | `schema.prisma` model count |
| Tenant-scoped models | 35 | `tenantModels.ts` |
| API route modules | 17 | `app.ts` mounts |
| OpenAPI paths | 164 | `paths.yaml` |
| OpenAPI operations | ~205 | YAML method keys |
| Backend services (approx.) | ~29 | `src/services` |
| Frontend routed pages | ~20 | `App.tsx` |
| Forms | 35 | `components/forms` |
| Prisma migrations | 9 SQL folders | `prisma/migrations` |
| Backend Vitest suites | 9 files | `backend/tests` |
| Frontend Vitest files | 1 | `brand.test.ts` |
| Product version (root) | 2.1.0 | root `package.json` |

---

## 24. Glossary

| Term | Meaning |
|------|---------|
| DN | Delivery Note |
| RBAC | Role-Based Access Control |
| ALS | AsyncLocalStorage tenant context |
| Platform Owner | Super Admin on configured platform company slug |
| Stub mode | Integration returns simulated responses without live credentials |

---

## 25. Evidence References

Primary paths inspected (non-exhaustive):

- `package.json`, `backend/package.json`, `frontend/package.json`  
- `docker-compose.yml`, `docker/*`, `.github/workflows/*`  
- `DEPLOYMENT.md`, `README.md`, `COMPLIANCE.md`  
- `backend/src/app.ts`, `backend/src/index.ts`  
- `backend/src/routes/*`, `backend/src/services/*`  
- `backend/src/middleware/*`, `backend/src/config/*`  
- `backend/prisma/schema.prisma`, `backend/prisma/migrations/*`  
- `backend/src/openapi/paths.yaml`  
- `frontend/src/App.tsx`, `frontend/src/pages/*`  
- `frontend/src/config/routeAccess.ts`, `frontend/src/utils/roleModules.ts`  
- `frontend/vite.config.ts`, `e2e/specs/smoke.spec.ts`  
- Project prompt file: `audit`  

---

## 26. Audit Constraints Compliance

| Constraint from `audit` prompt / user | Honored |
|---------------------------------------|---------|
| Do not modify codebase | Yes (only created this report under `Test Report/`) |
| Do not run tests | Yes |
| Do not install dependencies | Yes |
| Do not fix bugs / refactor / create PRs | Yes |
| Read/inspect/document only | Yes |
| One authoritative document | Yes — this file |

---

**End of report.**  
**Output location:** `Test Report/APEXCORE-ERP-Enterprise-Audit-Report.md`
