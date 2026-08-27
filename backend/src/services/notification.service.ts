import { NotificationType } from '@prisma/client';
import prisma from '../config/database';
import { EmailService } from './email.service';
import { getTenantId, requireTenantId, runWithTenant } from '../utils/tenant';
import { isLowStock, sumStockQuantities, toStockQty } from '../utils/stock';

export class NotificationService {
  static async notifyUser(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    link?: string
  ) {
    const companyId = requireTenantId();
    const notification = await prisma.notification.create({
      data: { companyId, userId, type, title, message, link },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (user?.email) {
      await EmailService.sendNotificationEmail(user.email, title, message, link, companyId);
    }

    return notification;
  }

  static async notifyRole(
    roleName: string,
    type: NotificationType,
    title: string,
    message: string,
    link?: string
  ) {
    const companyId = requireTenantId();
    const role = await prisma.role.findUnique({
      where: { name: roleName },
      include: {
        users: {
          where: { companyId, status: 'ACTIVE', deletedAt: null },
          select: { id: true, email: true },
        },
      },
    });

    if (!role || role.users.length === 0) return [];

    await prisma.notification.createMany({
      data: role.users.map((user) => ({
        companyId,
        userId: user.id,
        type,
        title,
        message,
        link,
      })),
    });

    await Promise.all(
      role.users
        .filter((user) => user.email)
        .map((user) =>
          EmailService.sendNotificationEmail(user.email!, title, message, link, companyId)
        )
    );

    return role.users.map((user) => user.id);
  }

  static async notifyAdmins(type: NotificationType, title: string, message: string, link?: string) {
    return this.notifyRole('Super Admin', type, title, message, link);
  }

  /**
   * Notify active users in any of the given roles (deduped), optionally skipping one user
   * (e.g. the actor who triggered the event).
   */
  static async notifyRolesExcept(
    roleNames: string[],
    type: NotificationType,
    title: string,
    message: string,
    link?: string,
    excludeUserId?: string | null
  ) {
    const companyId = requireTenantId();
    const users = await prisma.user.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        deletedAt: null,
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
        role: { name: { in: roleNames } },
      },
      select: { id: true, email: true },
    });

    if (users.length === 0) return [];

    await prisma.notification.createMany({
      data: users.map((user) => ({
        companyId,
        userId: user.id,
        type,
        title,
        message,
        link,
      })),
    });

    await Promise.all(
      users
        .filter((user) => user.email)
        .map((user) =>
          EmailService.sendNotificationEmail(user.email!, title, message, link, companyId)
        )
    );

    return users.map((user) => user.id);
  }

  static async runLowStockCheck() {
    const companyId = getTenantId();
    if (!companyId) return;

    const materials = await prisma.rawMaterial.findMany({
      where: { isActive: true, deletedAt: null },
      include: {
        stockLevels: { where: { warehouse: { companyId } } },
      },
    });

    const withTotals = materials.map((m) => ({
      material: m,
      total: sumStockQuantities(m.stockLevels),
      min: toStockQty(m.minStockLevel),
    }));

    const outOfStock = withTotals.filter((row) => row.total <= 0);
    const belowMin = withTotals.filter((row) => row.total > 0 && isLowStock(row.total, row.min));

    if (outOfStock.length === 0 && belowMin.length === 0) return;

    const since = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const recentAlert = await prisma.notification.findFirst({
      where: {
        companyId,
        type: 'LOW_STOCK',
        isRead: false,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (recentAlert) return;

    const formatRow = (row: (typeof withTotals)[number]) =>
      `${row.material.name} (${row.material.code}) — ${row.total.toLocaleString()} ${row.material.unit}`;

    if (outOfStock.length > 0) {
      const title = `${outOfStock.length} raw material(s) out of stock`;
      const message = outOfStock
        .slice(0, 5)
        .map(formatRow)
        .join('; ');
      await this.notifyRole('Production Manager', 'LOW_STOCK', title, message, '/inventory');
      await this.notifyRole('Procurement Officer', 'LOW_STOCK', title, message, '/inventory');
      await this.notifyRole('Warehouse Officer', 'LOW_STOCK', title, message, '/inventory');
      return;
    }

    const title = `${belowMin.length} raw material(s) below minimum stock`;
    const message = belowMin
      .slice(0, 5)
      .map(formatRow)
      .join('; ');

    await this.notifyRole('Production Manager', 'LOW_STOCK', title, message, '/inventory');
    await this.notifyRole('Procurement Officer', 'LOW_STOCK', title, message, '/inventory');
    await this.notifyRole('Warehouse Officer', 'LOW_STOCK', title, message, '/inventory');
  }

  static async runLowStockCheckForAllCompanies() {
    const companies = await prisma.company.findMany({
      where: { isActive: true },
      select: { id: true },
    });

    for (const company of companies) {
      await runWithTenant({ companyId: company.id }, () => this.runLowStockCheck());
    }
  }

  static async notifyApprovalNeeded(entityType: string, entityId: string, title: string) {
    await this.notifyRole(
      'Operations Manager',
      'APPROVAL',
      title,
      `A new ${entityType} requires your approval.`,
      `/procurement`
    );
  }

  static async notifyDriverDeliveryAssigned(input: {
    driverId: string;
    tripNo?: string;
    deliveryNo?: string;
    orderNumbers: string[];
    scheduledDate?: Date | null;
  }) {
    const stopCount = input.orderNumbers.length;
    const label = input.tripNo
      ? `Trip ${input.tripNo} (${stopCount} order${stopCount === 1 ? '' : 's'})`
      : `Delivery ${input.deliveryNo}`;
    const ordersPreview = input.orderNumbers.slice(0, 3).join(', ');
    const extra =
      input.orderNumbers.length > 3 ? ` +${input.orderNumbers.length - 3} more` : '';
    const schedule = input.scheduledDate
      ? ` Scheduled for ${input.scheduledDate.toLocaleDateString('en-KE')}.`
      : '';

    await this.notifyUser(
      input.driverId,
      'DELIVERY',
      'New delivery assigned to you',
      `${label}: ${ordersPreview}${extra}.${schedule} Open Delivery to start the trip.`,
      '/delivery'
    );
  }
}