# ABEXCORE ERP — Compliance & Data Governance

**Version:** 1.0  
**Product:** ABEXCORE ERP v2.1  
**Owner:** AbexCore Technologies  

---

## 1. Privacy & Personal Data

ABEXCORE ERP processes business and employee data for tenant companies. Each tenant’s data is isolated by `companyId` at the database layer.

| Data category | Examples | Purpose | Retention |
|---------------|----------|---------|-----------|
| Identity | Name, email, phone | Authentication, HR | Until account deletion |
| Financial | Invoices, payments, ledger | Accounting | 7 years (Kenya tax law default) |
| Operational | Orders, inventory, production | ERP operations | Tenant-configurable; default 7 years |
| Audit | Login, mutations, admin actions | Security & compliance | 2 years minimum |

**Data subject requests:** Tenant admins export data via Reports/Excel exports. Full erasure is performed by platform owner via company deletion API (irreversible).

---

## 2. Data Retention Policy

| Record type | Default retention | Deletion method |
|-------------|-------------------|-----------------|
| Audit logs | 24 months | Scheduled purge job (recommended) |
| Login history | 12 months | Scheduled purge |
| Soft-deleted customers/products | 90 days | Hard delete job |
| Financial records | 7 years | Archive then purge |
| Demo data (owner workspace) | Session-based | Reset demo workspace |

Production deployments should configure automated retention jobs via cron or cloud scheduler.

---

## 3. Audit Policy

All security-sensitive actions are logged to `audit_logs`:

- Authentication success/failure
- User, role, and permission changes
- Finance mutations (invoices, payments, journal entries)
- Inventory & procurement mutations
- Tenant admin (company create/delete, demo seed/reset)
- Settings changes

Audit entries include: user, company, action, module, entity type/id, IP, timestamp, redacted before/after values.

**Access:** Super Admin / users with `users:read` can view audit logs in Settings → Users.

---

## 4. Security Controls

- JWT access tokens (15 min) + refresh token rotation (hashed at rest)
- RBAC with module:action permissions
- Optional TOTP 2FA (secrets encrypted at rest)
- Rate limiting on auth endpoints
- Helmet security headers, CORS allowlist
- Tenant-scoped Prisma middleware
- Circuit breakers on external integrations (M-Pesa)

---

## 5. Industry Standards (Kenya)

- **VAT:** 16% default; configurable per company
- **Payroll:** PAYE, NSSF, SHIF, Housing Levy fields supported
- **eTIMS:** Integration scaffold for KRA fiscal submission
- **M-Pesa:** STK push for customer payments

Formal ISO 27001 / SOC 2 certification is **not** claimed; this document describes implemented controls.

---

## 6. Incident Response

1. Detect via logs, Sentry alerts, or user report  
2. Contain: disable affected tenant/user, rotate JWT secrets  
3. Investigate audit logs and login history  
4. Notify affected tenants within 72 hours for data breaches  
5. Post-incident review and control update  

---

## 7. Contact

Data protection inquiries: **privacy@abexcore.com**  
Security incidents: **security@abexcore.com**
