# ApexCore ERP — Administrator Guide

## Roles & permissions

13 predefined roles with module-level permissions (`module:action`):

| Action | Meaning |
|--------|---------|
| `read` | View module |
| `create` | Add records |
| `update` | Edit records |
| `delete` | Remove records |
| `approve` | Approval workflows |

**Super Admin** bypasses all checks. Assign least privilege for production users.

## First deploy

See `DEPLOYMENT.md`. Summary:

```bash
docker compose up -d
docker compose exec backend npx prisma migrate deploy
SEED_ADMIN_PASSWORD='...' docker compose exec backend npm run db:seed:production
```

Admin must change password on first login.

## Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `JWT_SECRET` | Production | 48+ random chars |
| `JWT_REFRESH_SECRET` | Production | Different from JWT_SECRET |
| `DATABASE_URL` | Yes | MySQL connection |
| `SMTP_*` | Optional | Email notifications |
| `MPESA_*` | Optional | Daraja STK push |
| `SEED_ADMIN_PASSWORD` | Production seed | One-time setup |

## Backups

Daily MySQL dump (see `DEPLOYMENT.md` section 8). Test restore quarterly.

## Audit trail

All create/update/delete operations on protected routes write to `audit_logs` with user, IP, old/new values (passwords redacted).

View via **Users → Audit Logs** (Super Admin / authorized roles).

## Updates

```bash
git pull
docker compose build
docker compose up -d
# Migrations run automatically on backend start
```

## Security checklist

- [ ] Change default admin password
- [ ] Set strong JWT secrets
- [ ] Enable HTTPS (reverse proxy)
- [ ] Do not expose MySQL publicly
- [ ] Enforce 2FA for finance/admin roles
- [ ] Review user access monthly
