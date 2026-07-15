# ApexCore ERP — User Guide

Quick reference for daily users by module.

## Getting started

1. Open your company URL (e.g. `https://erp.yourcompany.co.ke`)
2. Sign in with credentials provided by IT
3. Change your password when prompted
4. Enable 2FA under **Settings → Security** (recommended)

## Dashboard

Overview of KPIs, sales trend, production status, and pending actions. Use the global search (top bar) to find customers, products, or orders.

## CRM & Customers

- **Customers** — manage accounts, contacts, credit limits, tax PIN
- **CRM** — complaints, opportunities, warranties

## Sales flow (order to cash)

1. **Sales → Quotations** — create quote for customer
2. **Convert to order** — creates sales order (credit limit checked)
3. **Production** — if make-to-order, create production order
4. **Delivery** — create delivery note (deducts finished goods stock)
5. **Finance → Invoices** — create invoice from order or manually
6. **Finance → Payments** — record payment (posts to general ledger)

## Procurement

1. **Requisition** → approve → **RFQ** → supplier quote → **PO**
2. **Goods receipt** — increases raw material stock

## Inventory

- **Stock levels** — view by warehouse
- **Adjust** — manual correction
- **Cycle count** — reconcile physical vs system (via API / IT)
- **Transfers** — move stock between warehouses

## Finance

- Invoices, payments, journal entries
- Reports: P&L, balance sheet, cash flow, VAT
- Export invoice PDF/Excel (uses your company profile)

## HR & Payroll

- Employee records (KRA PIN, NHIF, NSSF numbers)
- Payroll run calculates **PAYE, NSSF, SHIF, Housing Levy** automatically
- Approve leave requests

## Settings

- **Company Profile** — name, tax PIN, VAT rate (used everywhere)
- **Security** — enable two-factor authentication

## Support

Contact your system administrator for access issues. Refer to `ADMIN_GUIDE.md` for IT staff.
