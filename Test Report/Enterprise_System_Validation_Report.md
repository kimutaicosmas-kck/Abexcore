# ApexCore ERP — Enterprise System Validation Report

**Document type:** Production verification, benchmarking, scalability, reliability, resource utilization, and operational readiness assessment  
**Product:** ApexCore ERP  
**Root version (`package.json`):** 2.1.0  
**Backend / frontend package versions:** 2.0.0 (version skew vs root)  
**Validation date:** 2026-07-28  
**Laboratory:** External Validation Lab (`validation-lab/`) — independent of application source trees  
**Source prompt:** project-root file `testing`  
**Codebase modification policy:** **No application source was modified.** All lab scripts and evidence were written only under `validation-lab/` and this report under `test report/`.  
**Evidence root:** `validation-lab/evidence/`  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)  
2. [Scope](#2-scope)  
3. [Test Environment](#3-test-environment)  
4. [Test Methodology](#4-test-methodology)  
5. [Functional Results](#5-functional-results)  
6. [API Results](#6-api-results)  
7. [Database Results](#7-database-results)  
8. [Frontend Results](#8-frontend-results)  
9. [Mobile Results](#9-mobile-results)  
10. [Performance Benchmarks](#10-performance-benchmarks)  
11. [Load Testing Results](#11-load-testing-results)  
12. [Stress Testing Results](#12-stress-testing-results)  
13. [Endurance Testing Results](#13-endurance-testing-results)  
14. [Resource Utilization](#14-resource-utilization)  
15. [Scalability Assessment](#15-scalability-assessment)  
16. [Reliability Assessment](#16-reliability-assessment)  
17. [Security Assessment](#17-security-assessment)  
18. [UX Assessment](#18-ux-assessment)  
19. [Production Readiness](#19-production-readiness)  
20. [Risks](#20-risks)  
21. [Critical Findings](#21-critical-findings)  
22. [Bottlenecks](#22-bottlenecks)  
23. [Capacity Estimates](#23-capacity-estimates)  
24. [Recommendations](#24-recommendations)  
25. [Appendices](#25-appendices)  
26. [Raw Benchmark Tables](#26-raw-benchmark-tables)  
27. [Evidence Index](#27-evidence-index)  
28. [References](#28-references)  

---

## 1. Executive Summary

ApexCore ERP was subjected to an independent, evidence-based validation campaign covering environment/build integrity, automated functional suites, live API matrix probing, MySQL read-path latency, frontend production build metrics, corrected load/stress/endurance ladders, host resource snapshots, reliability continuity probes, and security response inspection.

### Certification verdict (evidence-supported)

| Domain | Verdict | Confidence |
|--------|---------|------------|
| Local functional core (order-to-cash paths covered by Vitest) | **Conditionally Ready** | High |
| API authenticated read surface (sampled) | **Partially Verified** | High |
| Database connectivity & read latency (small dataset) | **Pass (lab scale)** | High |
| Frontend production build | **Pass with size warning** | High |
| Load / stress capacity on this host | **Limited — degrade at ~500 concurrent** | High |
| Endurance (60s) | **Stable (no drift)** | Medium |
| Mobile device validation | **Insufficient evidence** | Low |
| Security hardening | **Fail / High risk items present** | High |
| Full production certification | **Not certified without remediation** | High |

**Overall production readiness score: 5.8 / 10**  
Score reflects strong workflow coverage in automated tests and healthy single-user latency, offset by stack-trace leakage in API errors, incomplete workflow seed data causing 4 Vitest failures, Playwright browser unavailability blocking E2E, frontend unit-test thinness (1 test), large JS bundle (~1.08 MB), and connection failures under 500-way concurrent stress on a memory-constrained workstation also hosting unrelated Docker workloads.

Cross-reference: [§19 Production Readiness](#19-production-readiness), [§21 Critical Findings](#21-critical-findings).

---

## 2. Scope

### In scope

- ApexCore ERP monorepo as deployed locally on the validation host  
- Backend Express API (`http://localhost:3001`)  
- Frontend Vite SPA (`http://localhost:5173`)  
- MySQL 8 via Docker container `erp-mysql`  
- Automated suites already present in the repository (executed read-only; not edited)  
- External lab scripts under `validation-lab/scripts/`  

### Out of scope / not executed

- Mutation of production databases outside the local lab tenant  
- Destructive reliability tests (forced disk-full, process kill of MySQL mid-transaction)  
- Multi-node horizontal scale / Kubernetes  
- Real M-Pesa / SMTP / KRA eTIMS live networks (integrations reported `disabled` by health)  
- Physical phone/tablet instrumentation  

### Assumptions (explicit)

1. Platform-owner credentials used for live API probes match the documented local defaults in `README.md`.  
2. Dataset size is representative of a **lab/demo tenant**, not a multi-year production ledger.  
3. Concurrent load was generated from the same host as the SUT (shared CPU/RAM contention).  

---

## 3. Test Environment

### 3.1 Host inventory (measured)

| Item | Value | Evidence |
|------|-------|----------|
| OS | Microsoft Windows 11 Pro 10.0.26200 (64-bit) | `17-host-resources.json` |
| CPU | 11th Gen Intel Core i5-1145G7 @ 2.60 GHz | 4 cores / 8 logical |
| RAM | 16064.2 MB total; **1972.2 MB free** at snapshot | `17-host-resources.json` |
| Disk C: | ~80.6 GB free of ~237 GB | Phase 1 shell inventory |
| Node.js | v24.16.0 | Phase 1 |
| npm | 11.13.0 | Phase 1 |
| Docker | 29.5.3; Compose v5.1.4 | Phase 1 |
| Git | 2.54.0.windows.1 | Phase 1 |
| GPU | Not profiled | Insufficient evidence for GPU metrics |

### 3.2 Runtime topology (observed)

```
[Validation Lab scripts]
        |
        +--> HTTP --> Frontend Vite :5173 (dev server, HTTP 200 on /login)
        |
        +--> HTTP --> Backend API :3001 (version 2.1.0 health)
        |
        +--> Prisma/MySQL --> Docker erp-mysql :3306 (MySQL 8.0.46, healthy)
```

Unrelated containers co-resident: `cemes-web`, `cemes-api`, `cemes-minio`, `cemes-mssql` (consume RAM/CPU — see [§14](#14-resource-utilization)).

### 3.3 Application health at campaign start

`GET /api/health` → **200**, `database: connected`, `version: 2.1.0`, timezone `Africa/Nairobi`, integrations: mpesa/email **disabled**, database **live**.  

Evidence: `01-health.json`.

### 3.4 Environment variables

Lab scripts used `API_BASE`, `FE_BASE`, `TEST_COMPANY_SLUG`, `TEST_EMAIL`, `TEST_PASSWORD` (defaults aligned to local platform-owner workspace). Secret values are **not** reproduced in this report.

---

## 4. Test Methodology

Aligned to the 18 phases in project file `testing`.

| Phase | Method | Lab artifact |
|-------|--------|--------------|
| 1 Environment | PowerShell/CIM + Docker inspection | `17-host-resources.json` |
| 2 Build | `tsc --noEmit` (backend); Vite build to external outDir | `backend-tsc-noemit.log`, `frontend-build.log` |
| 3 Functional | Backend Vitest + API matrix + E2E attempt | `backend-vitest.log`, `e2e-smoke.log` |
| 4 API | Authenticated GET matrix + negative auth | `04-api-matrix.json`, `04b-*`, `02-*` |
| 5 Database | Read-only Prisma/`information_schema` probe | `13-db-probe.json` |
| 6 Frontend | Dev server probes + production build sizes | `11-frontend.json`, `frontend-dist/` |
| 7 Mobile | PWA manifest/build only | Insufficient device evidence |
| 8–13 Perf/load/stress/endurance/resources/scale | Corrected concurrent fetch ladders | `08b-*`, `09b-*`, `10b-*`, `14-*` |
| 14 Reliability | Continuity + post-burst recovery | `16-reliability.json` |
| 15 Security | Auth negatives + header capture + stack leakage | `02-*`, `05-*`, `12-*` |
| 16 UX | E2E blocked; static route inventory + HTTP probes | Partial |
| 17–18 Readiness / certification | Synthesis of measured facts | This document |

**Correction note:** Initial load/endurance runs targeted `/api/v1/dashboard/stats`, which returns **404**. Those runs are retained as `08-load-ladder.json` / `10-endurance-60s.json` for audit trail but **must not** be used for capacity claims. Corrected evidence is `08b-*`, `09b-*`, `10b-*` ([§11](#11-load-testing-results)).

---

## 5. Functional Results

### 5.1 Backend automated suite (Vitest)

**Command:** `npm test` in `backend/` (no source edits)  
**Result:** **98 passed / 4 failed / 102 total** across 9 files  
**Duration:** 36.64s  
**Evidence:** `validation-lab/evidence/backend-vitest.log`

| Suite | Result | Notes |
|-------|--------|-------|
| `finance-reconciliation.test.ts` | Pass (4) | Bank recon, eTIMS stub, M-Pesa stub |
| `workflows.test.ts` | **4 fail / 11 pass** | Failures: empty materials/suppliers/machines seed for RFQ, P2P, production |
| `catalog.test.ts` | Pass (19) | Products/inventory/procurement auth gates |
| `users.test.ts` | Pass (11) | Includes self-deactivation guard |
| `dashboard.test.ts` | Pass (6) | KPIs/charts auth |
| `operations.test.ts` | Pass (19) | Quality/sales/delivery stats auth |
| `api.test.ts` | Pass (5) | Login validation |
| `admin.test.ts` | Pass (12) | Finance auth |
| `crm.test.ts` | Pass (11) | CRM auth |

**Passing integration workflows (measured):**

- Sales order create + status advance  
- Order → confirm → ready → delivery → auto invoice → credit sync  
- Partial delivery notes + partial invoices  
- Overdue invoice maintenance endpoint  
- Unauthenticated rejection on protected routes  

**Failing workflows (measured root cause):** assertions `expect(rawMaterialId).toBeTruthy()` / supplier / machine / warehouse IDs returned `undefined` — **empty list payloads**, not assertion framework defects. Cross-ref [§7](#7-database-results) counts (`raw_materials` approxRows 0 in top-table sample; procurement fixtures absent).

### 5.2 Frontend automated suite

**Command:** `npm test` in `frontend/`  
**Result:** **1 passed / 1 total** (`brand.test.ts`)  
**Evidence:** `frontend-vitest.log`  
**Interpretation:** Frontend automated coverage is insufficient for enterprise certification of UI modules.

### 5.3 Playwright E2E smoke

**Command:** `npx playwright test --config e2e/playwright.config.ts`  
**Result:** **3 failed** — Chromium executable missing in sandbox cache  
**Evidence:** `e2e-smoke.log`  
**Conclusion:** Insufficient evidence to certify browser UX workflows via E2E in this run.

### 5.4 Live functional API probes (platform owner)

Login succeeded (**200**, 492.111 ms) as Super Admin on company `00000000-0000-0000-0000-000000000001`. Evidence: `03-login.json`.

Representative module reads (status/ms) — full matrix in [§6](#6-api-results) and `04-api-matrix-summary.json`:

| Feature area | Endpoint sample | Status | Latency (ms) |
|--------------|-----------------|--------|--------------|
| Customers | `/api/v1/customers?limit=10` | 200 | 51.816 |
| Products | `/api/v1/products?limit=10` | 200 | 37.726 |
| Users | `/api/v1/users?limit=10` | 200 | 29.473 |
| Warehouses | `/api/v1/inventory/warehouses` | 200 | 32.752 |
| Sales orders | `/api/v1/operations/orders?limit=10` | 200 | 44.867 |
| Invoices | `/api/v1/finance/invoices?limit=10` | 200 | 47.219 |
| Delivery list | `/api/v1/delivery` (corrected) | 200 | 25.695 |
| Quality list | `/api/v1/quality` (corrected) | 200 | 16.597 |
| Dashboard KPIs | `/api/v1/dashboard/kpis` | 200 | 72.042 |
| Dashboard charts | `/api/v1/dashboard/charts` | 200 | 24.790 |
| Stock levels | `/api/v1/inventory/stock-levels?limit=10` | 200 | 15.321 |

### 5.5 Evidence — Functional

- Tests executed: Vitest backend/frontend; live login; authenticated GETs; E2E attempt  
- Commands: see Methodology  
- Dataset: local `filter_erp` / platform-owner tenant  
- Confidence: **High** for Vitest outcomes; **Low** for full UI feature matrix  
- Limitations: E2E browsers missing; not every OpenAPI operation exercised with mutations  

---

## 6. API Results

### 6.1 Catalog size (static)

From `backend/src/openapi/paths.yaml` (read-only count):

- **164** path templates  
- **205** HTTP operations (`get|post|put|patch|delete`)  

### 6.2 Live authenticated matrix (26 endpoints, first pass)

| Metric | Value |
|--------|-------|
| Total probed | 26 |
| HTTP 200 | 16 |
| HTTP 4xx | 10 |
| HTTP 5xx | 0 |
| Evidence | `04-api-matrix.json`, `04-api-matrix-summary.json`, `99-summary.json` |

**Client errors observed (not necessarily defects):**

| Endpoint | Status | Interpretation |
|----------|--------|----------------|
| `/api/v1/dashboard/stats` | 404 | Route does not exist; real routes are `/kpis`, `/charts` |
| `/api/v1/inventory/stock` | 404 | Wrong path; `/inventory/stock-levels` works |
| `/api/v1/operations/work-orders` | 404 | Path mismatch vs implementation |
| `/api/v1/delivery/notes` | 404 | Collection served at `/api/v1/delivery` |
| `/api/v1/quality/inspections` | 404 | Collection served at `/api/v1/quality` |
| `/api/v1/maintenance/schedules` | 404 | Path mismatch |
| `/api/v1/tenant/company` | 404 | Path mismatch |
| `/api/v1/products/categories` | 404 | Path mismatch |
| `/api/v1/finance/my-sales` | 400 | Query validation / required params |
| `/api/v1/search?q=a&limit=5` | 400 | Query schema rejection |

**Finding:** OpenAPI path inventory and runtime routes are **not fully aligned**. This impairs client generation and operational runbooks. Cross-ref [§21](#21-critical-findings).

### 6.3 Validation / error handling

Empty POST bodies rejected with **400** and field messages (`code/name`, `customerId/items`). Evidence: `05-validation-errors.json`.

### 6.4 Evidence — API

- Confidence: **High** for probed set; **Medium** for claiming “every endpoint” (205 ops not all exercised)  
- Limitations: Mutation/concurrency on write paths not exhaustively tested outside Vitest  

---

## 7. Database Results

### 7.1 Engine

| Metric | Value | Evidence |
|--------|-------|----------|
| Version | MySQL **8.0.46** | `13-db-probe.json` |
| Ping `SELECT 1` | 25.36 ms | same |
| Container | `erp-mysql` healthy, port 3306 | Docker ps / stats |

### 7.2 Row counts (exact via Prisma count)

| Entity | Count | Count query ms |
|--------|------:|---------------:|
| company | 1 | measured in probe |
| user (not deleted) | 4 | |
| customer | 2 | |
| product | 2 | |
| salesOrder | 10 | |
| invoice | 14 | |
| deliveryNote | 10 | |

### 7.3 Read latency (Prisma, 25 samples)

| Query | min | mean | p95 | p99 | max |
|-------|----:|-----:|----:|----:|----:|
| `customer.findMany(take:50)` | — | — | **1.904 ms** | — | — |
| `salesOrder.findMany(take:50)+include` | — | — | **5.03 ms** | — | — |

Evidence: `13-db-probe.json` (`customerP95`, `orderP95`).

### 7.4 API-mediated DB proxy (30 sequential GETs)

`/api/v1/customers?limit=50&page=1` → mean **22.605 ms**, p95 **33.185 ms**, 0 failures, payload 1243 bytes, **2** customers returned. Evidence: `06-db-proxy-latency.json`.

### 7.5 Indexes

`information_schema.STATISTICS` sampled for columns `companyId`, `salesPersonId`, `customerId`, `status` (200-row cap). Presence of tenant/sales indexes observed in dump — full EXPLAIN plans for hot queries were **not** captured in this campaign.

### 7.6 Not measured (explicit)

- Write TPS under load  
- Deadlocks / lock waits  
- Replication lag (single instance)  
- Connection pool saturation metrics from Prisma internals  

### 7.7 Evidence — Database

- Confidence: **High** for connectivity and small-data read latency; **Low** for production-scale DB capacity  
- Limitation: Dataset too small to stress InnoDB buffer pool or index selectivity  

---

## 8. Frontend Results

### 8.1 Dev server probes

| Path | Status | ms | bytes | Notes |
|------|--------|---:|------:|-------|
| `/` | 200 | 6.286 | 1338 | HTML shell |
| `/login` | 200 | 4.677 | 1338 | HTML shell |
| `/manifest.webmanifest` | 200 | 2.820 | 1338 | Returned as HTML in Vite SPA fallback (dev) |

Evidence: `11-frontend.json`. Dev server does not emit security headers (expected for Vite).

### 8.2 Production build (external outDir — no app source change)

**Command:** `npx vite build --outDir validation-lab/evidence/frontend-dist`  
**Duration:** **16200 ms** wall / Vite reported **7.48 s** transform  
**Output:** 11 files, **1,208,251 bytes** (~1.15 MB)  
**Main JS:** `index-C1N3_oH_.js` **1,080.82 kB** (gzip **304.03 kB**)  
**CSS:** 72.79 kB (gzip 12.43 kB)  
**PWA:** precache 13 entries (1155.35 KiB); `sw.js` generated  
**Warning:** chunk > 500 kB (Vite advisory)

Evidence: `frontend-build.log`, `frontend-build-ms.txt`, `frontend-build-size.txt`, `frontend-dist/`.

### 8.3 Typecheck / unit tests

- Backend `tsc --noEmit`: **exit 0** (`backend-tsc-noemit.log`)  
- Frontend unit tests: 1 test only ([§5.2](#52-frontend-automated-suite))  

### 8.4 SPA routes (static inventory from `App.tsx`)

Login, register redirect, password change, dashboard, users, customers, products, inventory, procurement, production, quality, sales, my-sales, sales-performance, delivery, finance, hr, maintenance, reports, settings, platform admin register-company, 404.

### 8.5 Evidence — Frontend

- Confidence: **High** for build size/time; **Low** for runtime rendering/a11y (no browser profiling)  
- Limitation: No Lighthouse/Web Vitals capture in this campaign  

---

## 9. Mobile Results

| Checkpoint | Result |
|------------|--------|
| PWA plugin build artifacts | Present (`sw.js`, manifest in dist) |
| Phone/tablet usability | **Not executed** |
| Touch / offline / battery / FPS | **Insufficient evidence** |
| Responsive layout measurements | **Insufficient evidence** |

**Conclusion:** Cannot certify mobile readiness. Cross-ref [§18](#18-ux-assessment).

---

## 10. Performance Benchmarks

### 10.1 Auth & health

| Operation | Status | Latency |
|-----------|--------|---------|
| Login (bcrypt path) | 200 | **492.111 ms** |
| `/api/health` | 200 | 70.293 ms |
| `/api/health/live` | 200 | 4.668 ms |
| `/api/health/ready` | 200 | 7.930 ms |
| Health sequential 200 hits | 200/200 | mean 1.872 ms, **p95 3.535 ms** |

Evidence: `03-login.json`, `01-health.json`, `14-health-load-200.json`.

### 10.2 Authenticated read (single-user samples)

See [§5.4](#54-live-functional-api-probes-platform-owner). Dashboard KPIs ~72 ms; list endpoints typically 15–52 ms on this dataset.

### 10.3 Statistical note

Percentiles computed in lab scripts via sorted-sample index method (`validation-lab/scripts/*.mjs`).  

---

## 11. Load Testing Results

**Corrected primary endpoint:** `GET /api/v1/customers?limit=10` (all **200**)  
**Evidence:** `08b-load-ladder-customers.json`, `99b-perf-corrected-summary.json`

| Concurrent users | Wall (ms) | Approx RPS | mean (ms) | p95 (ms) | p99 (ms) | Failures |
|-----------------:|----------:|-----------:|----------:|---------:|---------:|---------:|
| 1 | 18.498 | 54.06 | 18.448 | 18.448 | 18.448 | 0 |
| 10 | 59.868 | 167.034 | 56.359 | 57.949 | 57.949 | 0 |
| 25 | 169.416 | 147.566 | 160.227 | 164.046 | 164.217 | 0 |
| 50 | 342.560 | 145.960 | 329.405 | 336.461 | 336.974 | 0 |
| 100 | 506.772 | 197.327 | 477.563 | 483.893 | 484.620 | 0 |
| 250 | 1005.302 | **248.681** | 786.121 | **906.986** | 913.218 | 0 |

**Observation:** Throughput peaks near **249 RPS** at 250 concurrency while p95 exceeds **900 ms**. Latency grows roughly linearly with concurrency on this host — consistent with single-process Node + shared CPU saturation ([§14](#14-resource-utilization)).

**Invalid prior ladder:** `08-load-ladder.json` recorded 404s for `/dashboard/stats` — discarded for capacity claims.

---

## 12. Stress Testing Results

**Mixed endpoints:** health/live, dashboard/kpis, customers, orders, invoices  
**Evidence:** `09b-stress-mixed.json`

| Requests (burst) | Wall (ms) | RPS | p95 (ms) | Failures (status 0) | HTTP 200 |
|-----------------:|----------:|----:|---------:|--------------------:|---------:|
| 100 | 595.341 | 167.971 | 590.697 | 0 | 100 |
| 250 | 1504.147 | 166.207 | 1474.955 | 0 | 250 |
| 500 | 4225.951 | 118.317 | **4148.308** | **18 (3.6%)** | 482 |

**Breaking behavior:** At **500 concurrent mixed requests**, 18 fetches failed with status `0` (client-side connection errors / reset — not HTTP 5xx). No HTTP 429 rate-limit observed in this burst. Peak sustainable mixed burst without errors on this host: **≤250 concurrent**.

Cross-ref [§15](#15-scalability-assessment), [§22](#22-bottlenecks).

---

## 13. Endurance Testing Results

**Duration:** 60 seconds (prompt requests multi-hour; only 60s executed)  
**Endpoint:** `/api/v1/customers?limit=10`  
**Samples:** 59 @ ~1 Hz  
**Evidence:** `10b-endurance-customers-60s.json`

| Metric | Value |
|--------|------:|
| Failures | 0 |
| Non-200 | 0 |
| mean | 20.316 ms |
| p95 | 24.134 ms |
| p99 | 108.532 ms |
| first-half mean | 21.172 ms |
| second-half mean | 19.488 ms |
| drift (2nd − 1st) | **−1.684 ms** (no degradation) |

**Limitation:** 60s cannot certify memory leak absence over hours. Cross-ref [§16](#16-reliability-assessment).

---

## 14. Resource Utilization

### 14.1 Host snapshot during campaign

| Resource | Idle/Typical observation | Evidence |
|----------|--------------------------|----------|
| Free RAM | **~1.97 GB** free of 16 GB | `17-host-resources.json` |
| Node processes | 18 processes; one ~**952 MB** working set | same |
| Docker `erp-mysql` | **45.77% CPU**, **632.2 MiB** RAM during probe window | `docker stats` in same file |
| Unrelated MSSQL container | **1.361 GiB** RAM | same |

### 14.2 Lab process memory

`15-lab-process-memory.json` captures Node heap of the lab runner only — not the API process internals.

### 14.3 Evidence — Resources

- Confidence: **Medium** (point-in-time; not full time-series under each load step)  
- Limitation: No Prometheus/cAdvisor continuous series  

---

## 15. Scalability Assessment

| Dimension | Assessment | Evidence basis |
|-----------|------------|----------------|
| Vertical (this host) | Limited by CPU/RAM contention; p95 >900 ms at 250 conc. | §11, §14 |
| Horizontal API | Not tested (single Node process) | Insufficient evidence |
| Database scale | Small data only; indexes present but unproven at volume | §7 |
| First limiting resource | **Host memory + single-threaded event loop / Docker co-tenancy** | Stress failures at 500; MySQL CPU spike |
| Max sustainable (lab) | ~**100–150 RPS** authenticated reads with p95 <500 ms on this host **assumption:** interpolate §11 (50 conc ≈336 ms p95; 100 conc ≈484 ms p95) | Measured tables |
| 1000-user target | **Not reached** — stopped at 500 with errors | §12 |

---

## 16. Reliability Assessment

Evidence: `16-reliability.json`

| Probe | Result |
|-------|--------|
| Health continuity (20 samples / ~10 s) | **0 failures**; latency spiked to 1104 ms mid-window then recovered |
| Token reuse after 2 s | **200** in 17.479 ms |
| Post 100-burst recovery | **0** health failures; mean ready **4.767 ms** |
| Unexpected shutdown / DB restart / disk-full | **Not executed** — Insufficient evidence |
| Data consistency after crash | Insufficient evidence |

**Interpretation:** Soft recovery after burst is good; hard fault-injection remains unverified.

---

## 17. Security Assessment

### 17.1 Measured controls that passed

| Control | Result | Evidence |
|---------|--------|----------|
| Wrong password | 401 `Invalid email or password` | `02-auth-security.json` |
| Missing login fields | 400 validation | same |
| No token on protected route | 401 `Authentication required` | same |
| Garbage JWT | 401 `Invalid or expired token` | same |
| SQLi-like email | 400 `Invalid email address` (Zod) | same |
| Helmet headers | CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, HSTS present | `12-security-headers.json` |
| Empty body mutations | 400 | `05-validation-errors.json` |

### 17.2 Measured failures / high risks

1. **Stack traces returned in JSON error bodies** (paths to `auth.service.ts`, `validate.ts`, `auth.ts`) on 401/400 responses — information disclosure. Evidence: `02-auth-security.json`, `05-validation-errors.json`.  
2. **Login timing** ~492 ms enables timing-adjacent user enumeration risk if statuses differ (here wrong password also 401 — good — but stack still leaks).  
3. **Public `/uploads` serving** noted in prior audit; this run `GET /uploads/` → 404 (no listing) — insufficient to prove object ACLs.  
4. Rate-limit headers `x-ratelimit-remaining` were **null** on sampled responses (global limiter may be prod-only).  
5. Default platform credentials documented in README — operational secret hygiene risk (process finding, not a runtime exploit test).

### 17.3 OWASP mapping (evidence-limited)

| Area | Status |
|------|--------|
| A01 Broken Access Control | Partially tested (auth required); tenant isolation not red-teamed |
| A03 Injection | Login email injection blocked by validation |
| A05 Security Misconfiguration | **Stack traces in responses** = fail |
| A07 Auth failures | Basic negatives pass |
| Others | Insufficient evidence |

---

## 18. UX Assessment

| Criterion | Result | Evidence |
|-----------|--------|----------|
| Login page HTTP availability | Pass | `11-frontend.json` |
| Sign-in → dashboard (Playwright) | **Blocked** (no Chromium) | `e2e-smoke.log` |
| Finance reconciliation tab E2E | Blocked | same |
| Accessibility audit | Insufficient evidence | — |
| Mobile UX | Insufficient evidence | §9 |
| Error message clarity (API) | Messages clear; stacks should not reach clients | §17 |

---

## 19. Production Readiness

| Pillar | Score /10 | Rationale |
|--------|----------:|-----------|
| Reliability | 6 | Soft recovery OK; hard faults untested; 60s endurance only |
| Maintainability | 6 | TS clean compile; OpenAPI/runtime drift |
| Performance | 6 | Good single-user; degrades under concurrent stress on lab host |
| Security | 4 | Stack leakage; limited rate-limit evidence in dev |
| Scalability | 4 | Single node; 500-burst failures |
| Observability | 5 | Winston logs seen in tests; no metrics backend exercised |
| Deployment | 6 | Docker Compose present; staging workflow instructional |
| DR / backups | 5 | Scripts exist; restore not re-validated in this campaign |
| **Weighted overall** | **5.8** | Not certified for uncontrolled production scale |

**Gate decision:** **CONDITIONAL GO** for closed pilot / single-tenant staging **after** remediating stack-trace disclosure and stabilizing seed data for failed workflows. **NO-GO** for multi-tenant public production until load tests on dedicated servers and E2E/mobile evidence exist.

---

## 20. Risks

| ID | Risk | Likelihood | Impact | Link |
|----|------|------------|--------|------|
| R1 | Error stack traces expose internals | High | High | §17 |
| R2 | OpenAPI/runtime path drift breaks clients | High | Medium | §6 |
| R3 | Workflow Vitest failures mask procurement/production regressions | Medium | High | §5 |
| R4 | Host resource contention masks true capacity | High | Medium | §14–15 |
| R5 | Large SPA bundle slows mobile networks | Medium | Medium | §8 |
| R6 | Thin frontend test suite | High | Medium | §5.2 |
| R7 | E2E not executable in lab → UI regressions undetected | High | High | §5.3 |
| R8 | Small DB dataset underestimates query cost | High | High | §7 |

---

## 21. Critical Findings

1. **CF-01 (Security):** API error responses include full `stack` strings in development-style payloads. Measured on login failure and validation errors.  
2. **CF-02 (Quality):** 4 workflow integration tests fail due to missing seed entities (materials/suppliers/machines), reducing confidence in procure-to-pay and production paths.  
3. **CF-03 (Contract):** Multiple documented/probed paths 404 while alternate routes succeed — API contract inconsistency.  
4. **CF-04 (Capacity):** 3.6% connection failures at 500 concurrent mixed requests on the validation host.  
5. **CF-05 (Verification gap):** Playwright browsers unavailable; mobile and full UX uncertified.  

---

## 22. Bottlenecks

| Rank | Bottleneck | Signal |
|------|------------|--------|
| 1 | Shared host RAM (~2 GB free) + co-located containers | Docker MSSQL 1.36 GiB; stress status 0 |
| 2 | Single Node API process under fan-out concurrency | p95 907 ms at 250 conc. customers |
| 3 | MySQL CPU spikes during probes | `erp-mysql` 45.77% CPU in snapshot |
| 4 | Monolithic frontend bundle | 1.08 MB JS before gzip |
| 5 | Login/bcrypt cost | ~492 ms per login |

---

## 23. Capacity Estimates

> Estimates below are **bound to the measured lab host and tiny dataset**. They are not a guarantee for production hardware.

| Workload class | Estimate | Basis |
|----------------|----------|-------|
| Interactive users (read-heavy ERP) | **~25–40 concurrent** with p95 <200 ms | §11 interpolation |
| Burst API reads | **~150–200 RPS** peak before p95 >500 ms | §11 |
| Hard fail region | **~500 concurrent** mixed requests | §12 |
| DB row scale tested | tens of rows | §7 |
| 1000 VU | **Not demonstrated** | — |

---

## 24. Recommendations

> Recommendations are **not** measured facts.

1. Suppress `stack` in API JSON for non-development environments; keep logs server-side only.  
2. Align OpenAPI `paths.yaml` with Express routers; add contract tests.  
3. Fix demo/seed data so RFQ/P2P/production Vitest paths remain green in CI.  
4. Install Playwright browsers in CI and enforce smoke E2E.  
5. Code-split the Vite bundle; set performance budgets.  
6. Re-run load/stress on a dedicated 4–8 GB VPS without co-tenant containers; capture CPU/RAM time series.  
7. Extend endurance to ≥4 hours with heap sampling.  
8. Add frontend component/integration tests for sales, delivery, finance.  
9. Execute tenant-isolation negative tests (cross-company ID access).  
10. Validate backup restore on a schedule and attach results to the next certification cycle.  

---

## 25. Appendices

### A. Validation lab layout

```
validation-lab/
  README.md
  scripts/
    run-validation.mjs
    perf-rerun.mjs
    db-probe.mjs
    reliability-probe.mjs
  evidence/
    *.json, *.log, frontend-dist/
test report/
  Enterprise_System_Validation_Report.md   ← this file
```

### B. Version skew

| Package | Version |
|---------|---------|
| Root | 2.1.0 |
| Backend | 2.0.0 |
| Frontend | 2.0.0 |
| Health payload | 2.1.0 |

### C. Discarded / superseded measurements

| File | Reason |
|------|--------|
| `08-load-ladder.json` | Hit 404 endpoint |
| `10-endurance-60s.json` | Hit 404 endpoint |
| `07-concurrency-25.json` | Same 404 path |

Use `08b`, `09b`, `10b` instead.

---

## 26. Raw Benchmark Tables

### 26.1 Corrected load ladder

See [§11](#11-load-testing-results) — source JSON `08b-load-ladder-customers.json`.

### 26.2 Stress

See [§12](#12-stress-testing-results) — source JSON `09b-stress-mixed.json`.

### 26.3 Health load (200 requests)

| metric | value |
|--------|------:|
| failures | 0 |
| mean ms | 1.872 |
| p95 ms | 3.535 |
| p99 ms | 4.019 |

Source: `14-health-load-200.json`.

### 26.4 DB Prisma p95

| query | p95 ms |
|-------|-------:|
| customers take 50 | 1.904 |
| sales orders take 50 + include | 5.03 |

Source: `13-db-probe.json`.

---

## 27. Evidence Index

| File | Phase(s) |
|------|----------|
| `00-meta.json` | Meta |
| `01-health.json` | 1, 4, 10 |
| `02-auth-security.json` | 15 |
| `03-login.json` | 3, 4, 10 |
| `04-api-matrix.json` / `04-api-matrix-summary.json` | 4, 6 |
| `04b-api-path-corrections.json` | 4 |
| `05-validation-errors.json` | 3, 15 |
| `06-db-proxy-latency.json` | 5, 10 |
| `08b-load-ladder-customers.json` | 9, 11 |
| `09b-stress-mixed.json` | 10, 12 |
| `10b-endurance-customers-60s.json` | 11, 13 |
| `11-frontend.json` | 6 |
| `12-security-headers.json` | 15 |
| `13-db-probe.json` | 5 |
| `14-health-load-200.json` | 8, 10 |
| `15-lab-process-memory.json` | 12 |
| `16-reliability.json` | 14 |
| `17-host-resources.json` | 1, 12 |
| `99-summary.json` / `99b-perf-corrected-summary.json` | Rollup |
| `backend-vitest.log` | 3 |
| `frontend-vitest.log` | 3 |
| `frontend-build.log` | 2, 6 |
| `backend-tsc-noemit.log` | 2 |
| `e2e-smoke.log` | 3, 16 |
| `run-validation.log` / `perf-rerun.log` / `db-probe.log` / `reliability.log` | Runner stdout |

All paths relative to `validation-lab/evidence/` unless noted.

---

## 28. References

1. Project prompt: `testing` (Enterprise Software Validation & Performance Certification System Prompt)  
2. Product docs: `README.md`, `DEPLOYMENT.md`, `COMPLIANCE.md`  
3. Prior static audit (separate historical artifact): `Test Report/APEXCORE-ERP-Enterprise-Audit-Report.md` — **not** a substitute for this validation report  
4. OpenAPI: `backend/src/openapi/paths.yaml`  
5. Lab runners: `validation-lab/scripts/*.mjs`  

---

### Document control

| Field | Value |
|-------|-------|
| Title | Enterprise_System_Validation_Report |
| Status | Final for this campaign |
| Authors | External Validation Laboratory (Cursor agent execution) |
| Reproducibility | Re-run scripts in `validation-lab/README.md` against the same topology |
| Next certification trigger | After CF-01…CF-05 remediation + dedicated-host load retest |

---

*End of single continuous Enterprise System Validation Report.*
