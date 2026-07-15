# ApexCore ERP — Full Delivery Roadmap

This document tracks completion of production-grade delivery items.

## Phase 0 — Security & trust ✅ (implemented)

- [x] JWT secrets required in production (`config/index.ts`)
- [x] Remove pre-filled login credentials
- [x] Force password change flag (`mustChangePassword`) + `/change-password` page
- [x] 2FA login enforcement + Settings UI to enable
- [x] Docker MySQL bound to localhost (`127.0.0.1:3307`)
- [x] Production seed script (`npm run db:seed:production`) — no demo data
- [x] Audit log captures `oldValues` + redacts passwords

## Phase 1 — Business workflows ✅ (implemented)

- [x] Dynamic VAT from `Company.vatRate` (backend + sales forms)
- [x] Company branding on PDF/Excel exports
- [x] Credit limit enforcement on sales orders
- [x] Order status transition validation
- [x] FG stock deduction on dispatch
- [x] Invoice from sales order (`POST /finance/invoices/from-order/:orderId`)
- [x] Payment → journal entry (AR/Cash)
- [x] Sales invoice → GL posting
- [x] Cycle count API (`POST /inventory/cycle-counts`)
- [x] Quotation convert guard (prevent double conversion)

## Phase 2 — Kenya readiness ✅ (partial)

- [x] PAYE / NSSF / SHIF / Housing Levy payroll calculator
- [x] Payroll API uses statutory breakdown
- [x] Employee KRA/NHIF/NSSF fields in schema
- [x] M-Pesa payment reference validation
- [x] M-Pesa Daraja service scaffold (`MpesaService`)
- [ ] Live M-Pesa STK push (requires Safaricom credentials)
- [ ] KRA eTIMS integration
- [ ] P9 / statutory export reports

## Phase 3 — Quality & ops ✅ (partial)

- [x] CI: migrate + seed + full test run
- [x] CI: Docker compose build job
- [x] Vitest serial execution (parallel login fix)
- [ ] Playwright E2E suite
- [ ] Structured logging / Sentry
- [ ] Automated MySQL backup cron

## Phase 4 — Enterprise (planned)

- [ ] Branch/warehouse-scoped RBAC
- [ ] Configurable approval chains
- [ ] SSO / LDAP
- [ ] Session admin (revoke tokens)
- [ ] httpOnly cookie auth
- [ ] Multi-tenant support

## Documentation

| Document | Purpose |
|----------|---------|
| `DEPLOYMENT.md` | Go-live runbook |
| `USER_GUIDE.md` | End-user module guide |
| `ADMIN_GUIDE.md` | IT admin & permissions |

## Commands

```bash
# Development
npm run dev

# Production seed (first deploy)
SEED_ADMIN_PASSWORD='YourStrongPass1' npm run db:seed:production

# Tests
cd backend && npm test

# Docker
docker compose build && docker compose up -d
docker compose exec backend npm run db:seed:production
```
