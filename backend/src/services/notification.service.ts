import { NotificationType } from '@prisma/client';
import prisma from '../config/database';
import { EmailService } from './email.service';

export class NotificationService {
  static async notifyUser(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    link?: string
  ) {
    const notification = await prisma.notification.create({
      data: { userId, type, title, message, link },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (user?.email) {
      await EmailService.sendNotificationEmail(user.email, title, message, link);
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
    const role = await prisma.role.findUnique({
      where: { name: roleName },
      include: { users: { where: { status: 'ACTIVE', deletedAt: null } } },
    });

    if (!role) return [];

    return Promise.all(
      role.users.map((u) => this.notifyUser(u.id, type, title, message, link))
    );
  }

  static async notifyAdmins(type: NotificationType, title: string, message: string, link?: string) {
    return this.notifyRole('Super Admin', type, title, message, link);
  }

  static async runLowStockCheck() {
    const materials = await prisma.rawMaterial.findMany({
      where: { isActive: true, deletedAt: null },
      include: { stockLevels: true },
    });

    const lowStock = materials.filter((m) => {
      const total = m.stockLevels.reduce((s, sl) => s + Number(sl.quantity), 0);
      return total <= Number(m.minStockLevel);
    });

    if (lowStock.length === 0) return;

    const title = `${lowStock.length} material(s) below minimum stock`;
    const message = lowStock
      .slice(0, 5)
      .map((m) => `${m.name} (${m.code})`)
      .join(', ');

    await this.notifyRole('Procurement Officer', 'LOW_STOCK', title, message, '/inventory');
    await this.notifyRole('Warehouse Officer', 'LOW_STOCK', title, message, '/inventory');
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
}
