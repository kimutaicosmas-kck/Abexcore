import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { config } from '../config';
import { runWithoutTenant } from '../utils/tenant';
import fs from 'fs/promises';
import path from 'path';
import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

async function collectIds(tx: Tx, companyId: string) {
  const [
    warehouses,
    products,
    customers,
    suppliers,
    users,
    employees,
    invoices,
    payments,
    journalEntries,
    deliveryTrips,
    salesOrders,
    salesQuotations,
    productionOrders,
    purchaseOrders,
    goodsReceipts,
    purchaseRequisitions,
    requestForQuotations,
    machines,
    bankStatements,
  ] = await Promise.all([
    tx.warehouse.findMany({ where: { companyId }, select: { id: true } }),
    tx.product.findMany({ where: { companyId }, select: { id: true } }),
    tx.customer.findMany({ where: { companyId }, select: { id: true } }),
    tx.supplier.findMany({ where: { companyId }, select: { id: true } }),
    tx.user.findMany({ where: { companyId }, select: { id: true } }),
    tx.employee.findMany({ where: { companyId }, select: { id: true } }),
    tx.invoice.findMany({ where: { companyId }, select: { id: true } }),
    tx.payment.findMany({ where: { companyId }, select: { id: true } }),
    tx.journalEntry.findMany({ where: { companyId }, select: { id: true } }),
    tx.deliveryTrip.findMany({ where: { companyId }, select: { id: true } }),
    tx.salesOrder.findMany({ where: { companyId }, select: { id: true } }),
    tx.salesQuotation.findMany({ where: { companyId }, select: { id: true } }),
    tx.productionOrder.findMany({ where: { companyId }, select: { id: true } }),
    tx.purchaseOrder.findMany({ where: { companyId }, select: { id: true } }),
    tx.goodsReceipt.findMany({ where: { companyId }, select: { id: true } }),
    tx.purchaseRequisition.findMany({ where: { companyId }, select: { id: true } }),
    tx.requestForQuotation.findMany({ where: { companyId }, select: { id: true } }),
    tx.machine.findMany({ where: { companyId }, select: { id: true } }),
    tx.bankStatement.findMany({ where: { companyId }, select: { id: true } }),
  ]);

  const pick = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id);

  return {
    warehouseIds: pick(warehouses),
    productIds: pick(products),
    customerIds: pick(customers),
    supplierIds: pick(suppliers),
    userIds: pick(users),
    employeeIds: pick(employees),
    invoiceIds: pick(invoices),
    paymentIds: pick(payments),
    journalEntryIds: pick(journalEntries),
    deliveryTripIds: pick(deliveryTrips),
    salesOrderIds: pick(salesOrders),
    salesQuotationIds: pick(salesQuotations),
    productionOrderIds: pick(productionOrders),
    purchaseOrderIds: pick(purchaseOrders),
    goodsReceiptIds: pick(goodsReceipts),
    purchaseRequisitionIds: pick(purchaseRequisitions),
    requestForQuotationIds: pick(requestForQuotations),
    machineIds: pick(machines),
    bankStatementIds: pick(bankStatements),
  };
}

export async function deleteCompanyCompletely(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, slug: true, name: true, logo: true },
  });
  if (!company) throw new AppError('Company not found', 404);
  if (company.slug === config.platformCompanySlug) {
    throw new AppError('The platform owner company cannot be deleted', 400);
  }

  await runWithoutTenant(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');

        try {
          const ids = await collectIds(tx, companyId);

          if (ids.paymentIds.length) {
            await tx.paymentAllocation.deleteMany({ where: { paymentId: { in: ids.paymentIds } } });
          }
          if (ids.invoiceIds.length) {
            await tx.invoiceItem.deleteMany({ where: { invoiceId: { in: ids.invoiceIds } } });
          }
          if (ids.invoiceIds.length) {
            await tx.invoice.deleteMany({ where: { id: { in: ids.invoiceIds } } });
          }
          if (ids.paymentIds.length) {
            await tx.payment.deleteMany({ where: { id: { in: ids.paymentIds } } });
          }
          if (ids.journalEntryIds.length) {
            await tx.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids.journalEntryIds } } });
            await tx.journalEntry.deleteMany({ where: { id: { in: ids.journalEntryIds } } });
          }

          const deliveryNoteIds = new Set<string>();
          const notesByCompany = await tx.deliveryNote.findMany({
            where: { companyId },
            select: { id: true },
          });
          notesByCompany.forEach((n) => deliveryNoteIds.add(n.id));
          if (ids.salesOrderIds.length) {
            const notes = await tx.deliveryNote.findMany({
              where: { salesOrderId: { in: ids.salesOrderIds } },
              select: { id: true },
            });
            notes.forEach((n) => deliveryNoteIds.add(n.id));
          }
          if (ids.deliveryTripIds.length) {
            const notes = await tx.deliveryNote.findMany({
              where: { deliveryTripId: { in: ids.deliveryTripIds } },
              select: { id: true },
            });
            notes.forEach((n) => deliveryNoteIds.add(n.id));
          }
          const noteIds = [...deliveryNoteIds];
          if (noteIds.length) {
            await tx.deliveryItem.deleteMany({ where: { deliveryNoteId: { in: noteIds } } });
            await tx.deliveryNote.deleteMany({ where: { id: { in: noteIds } } });
          }

          if (ids.goodsReceiptIds.length) {
            await tx.goodsReceiptItem.deleteMany({ where: { goodsReceiptId: { in: ids.goodsReceiptIds } } });
          }
          if (ids.purchaseOrderIds.length) {
            await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: { in: ids.purchaseOrderIds } } });
          }
          if (ids.requestForQuotationIds.length) {
            await tx.supplierQuotation.deleteMany({ where: { rfqId: { in: ids.requestForQuotationIds } } });
          }
          if (ids.purchaseRequisitionIds.length) {
            await tx.purchaseRequisitionItem.deleteMany({ where: { requisitionId: { in: ids.purchaseRequisitionIds } } });
          }
          if (ids.salesQuotationIds.length) {
            await tx.quotationItem.deleteMany({ where: { quotationId: { in: ids.salesQuotationIds } } });
          }
          if (ids.salesOrderIds.length) {
            await tx.salesOrderItem.deleteMany({ where: { salesOrderId: { in: ids.salesOrderIds } } });
          }
          if (ids.productionOrderIds.length) {
            await tx.productionConsumption.deleteMany({ where: { productionOrderId: { in: ids.productionOrderIds } } });
            await tx.productionBatch.deleteMany({ where: { productionOrderId: { in: ids.productionOrderIds } } });
            await tx.qualityInspection.deleteMany({ where: { productionOrderId: { in: ids.productionOrderIds } } });
          }
          if (ids.productIds.length) {
            const boms = await tx.billOfMaterial.findMany({
              where: { productId: { in: ids.productIds } },
              select: { id: true },
            });
            const bomIds = boms.map((b) => b.id);
            if (bomIds.length) {
              await tx.billOfMaterialItem.deleteMany({ where: { bomId: { in: bomIds } } });
              await tx.billOfMaterial.deleteMany({ where: { id: { in: bomIds } } });
            }
          }
          if (ids.warehouseIds.length) {
            await tx.inventoryTransaction.deleteMany({ where: { warehouseId: { in: ids.warehouseIds } } });
            await tx.stockLevel.deleteMany({ where: { warehouseId: { in: ids.warehouseIds } } });
            await tx.warehouseLocation.deleteMany({ where: { warehouseId: { in: ids.warehouseIds } } });
          }
          if (ids.customerIds.length) {
            await tx.customerContact.deleteMany({ where: { customerId: { in: ids.customerIds } } });
            await tx.opportunity.deleteMany({ where: { customerId: { in: ids.customerIds } } });
            await tx.complaint.deleteMany({ where: { customerId: { in: ids.customerIds } } });
            await tx.warranty.deleteMany({ where: { customerId: { in: ids.customerIds } } });
          }
          if (ids.supplierIds.length) {
            await tx.supplierContract.deleteMany({ where: { supplierId: { in: ids.supplierIds } } });
          }
          if (ids.userIds.length) {
            await tx.refreshToken.deleteMany({ where: { userId: { in: ids.userIds } } });
            await tx.loginHistory.deleteMany({ where: { userId: { in: ids.userIds } } });
          }
          if (ids.employeeIds.length) {
            await tx.attendance.deleteMany({ where: { employeeId: { in: ids.employeeIds } } });
            await tx.leaveBalance.deleteMany({ where: { employeeId: { in: ids.employeeIds } } });
            await tx.leaveRequest.deleteMany({ where: { employeeId: { in: ids.employeeIds } } });
            const advanceIds = (
              await tx.salaryAdvance.findMany({
                where: { employeeId: { in: ids.employeeIds } },
                select: { id: true },
              })
            ).map((a) => a.id);
            if (advanceIds.length) {
              await tx.salaryAdvanceRepayment.deleteMany({ where: { advanceId: { in: advanceIds } } });
              await tx.salaryAdvance.deleteMany({ where: { id: { in: advanceIds } } });
            }
            await tx.payrollRecord.deleteMany({ where: { employeeId: { in: ids.employeeIds } } });
          }
          if (ids.bankStatementIds.length) {
            await tx.bankStatementLine.deleteMany({ where: { statementId: { in: ids.bankStatementIds } } });
          }
          if (ids.machineIds.length) {
            await tx.maintenanceRequest.deleteMany({ where: { machineId: { in: ids.machineIds } } });
          }

          await tx.mpesaTransaction.deleteMany({ where: { companyId } });
          await tx.bankStatement.deleteMany({ where: { companyId } });
          await tx.account.deleteMany({ where: { companyId } });
          await tx.deliveryTrip.deleteMany({ where: { companyId } });
          await tx.vehicle.deleteMany({ where: { companyId } });
          await tx.salesTarget.deleteMany({ where: { companyId } });
          await tx.salesOrder.deleteMany({ where: { companyId } });
          await tx.salesQuotation.deleteMany({ where: { companyId } });
          await tx.productionOrder.deleteMany({ where: { companyId } });
          await tx.machine.deleteMany({ where: { companyId } });
          await tx.goodsReceipt.deleteMany({ where: { companyId } });
          await tx.purchaseOrder.deleteMany({ where: { companyId } });
          await tx.requestForQuotation.deleteMany({ where: { companyId } });
          await tx.purchaseRequisition.deleteMany({ where: { companyId } });
          await tx.product.deleteMany({ where: { companyId } });
          await tx.productCategory.deleteMany({ where: { companyId } });
          await tx.rawMaterial.deleteMany({ where: { companyId } });
          await tx.materialType.deleteMany({ where: { companyId } });
          await tx.supplier.deleteMany({ where: { companyId } });
          await tx.customer.deleteMany({ where: { companyId } });
          await tx.warehouse.deleteMany({ where: { companyId } });
          await tx.notification.deleteMany({ where: { companyId } });
          await tx.auditLog.deleteMany({ where: { companyId } });
          await tx.emailConfig.deleteMany({ where: { companyId } });
          await tx.employee.deleteMany({ where: { companyId } });
          await tx.user.deleteMany({ where: { companyId } });
          await tx.department.deleteMany({ where: { companyId } });
          await tx.taxRate.deleteMany({ where: { companyId } });
          await tx.branch.deleteMany({ where: { companyId } });
          await tx.company.delete({ where: { id: companyId } });
        } finally {
          await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
        }
      },
      { timeout: 120_000 }
    )
  );

  if (company.logo?.startsWith('/uploads/companies/')) {
    const filename = path.basename(company.logo);
    const filePath = path.join(config.uploadDir, 'companies', filename);
    await fs.unlink(filePath).catch(() => undefined);
  }

  return { id: company.id, slug: company.slug, name: company.name };
}
